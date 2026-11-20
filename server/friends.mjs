const friendPair = (a, b) => [a, b].sort();
const messagePageSize = 40;
const friendPresenceLifetime = 45_000;

function friendView(row, self) {
  const first = row.first_id === self;
  return {
    id: first ? row.second_id : row.first_id,
    nickname: first ? row.second_name : row.first_name,
    status: row.accepted ? 'friend' : row.requester === self ? 'sent' : 'received',
    ...(row.unread ? { unread: row.unread } : {})
  };
}

function messageView(row, sender) {
  return { seq: row.seq, mine: row.sender === sender, text: row.body, at: row.sent_at };
}

function messagePage(rows, sender) {
  return {
    messages: rows.slice(0, messagePageSize).reverse().map(row => messageView(row, sender)),
    hasOlder: rows.length > messagePageSize
  };
}

export function databaseFriends(db) {
  return {
    async presence(self, tab, sharing, now) {
      if (sharing === 'show') {
        await db.prepare(`INSERT INTO friend_presence (account, tab, expires_at)
          SELECT ?1, ?2, ?3 WHERE EXISTS (
            SELECT 1 FROM friendships WHERE accepted = 1 AND (first_id = ?1 OR second_id = ?1)
          ) ON CONFLICT(account, tab) DO UPDATE SET expires_at = excluded.expires_at
          WHERE friend_presence.expires_at <= excluded.expires_at - 10000`)
          .bind(self, tab, now + friendPresenceLifetime).run();
      } else if (sharing === 'hide') {
        await db.prepare('DELETE FROM friend_presence WHERE account = ? AND tab = ?').bind(self, tab).run();
      }
      const { results } = await db.prepare(`WITH peers(id, nickname) AS (
        SELECT second_id, second_name FROM friendships WHERE first_id = ?1 AND accepted = 1
        UNION ALL SELECT first_id, first_name FROM friendships WHERE second_id = ?1 AND accepted = 1
      ) SELECT id, nickname FROM peers WHERE EXISTS (
        SELECT 1 FROM friend_presence WHERE account = peers.id AND expires_at > ?2
      )`).bind(self, now).all();
      return results;
    },
    async identity(user) {
      return (await db.prepare('SELECT guest_key FROM friend_identity WHERE user_id = ?').bind(user).first())?.guest_key;
    },
    async bindIdentity(user, guestKey) {
      await db.prepare('INSERT OR IGNORE INTO friend_identity (user_id, guest_key) VALUES (?, ?)').bind(user, guestKey).run();
      return await this.identity(user) === guestKey;
    },
    async list(self) {
      const { results } = await db.prepare(`SELECT f.*,
        CASE WHEN f.accepted = 1 THEN (SELECT COUNT(*) FROM friend_messages m
          WHERE m.first_id = f.first_id AND m.second_id = f.second_id AND m.read_at IS NULL AND m.sender = (f.first_id = ?1)) END AS unread
        FROM friendships f WHERE f.first_id = ?1 OR f.second_id = ?1 ORDER BY f.accepted ASC, f.created_at DESC`).bind(self).all();
      return results.map(row => friendView(row, self));
    },
    async thread(self, peer, before, now) {
      const [first, second] = friendPair(self, peer);
      const sender = self === first ? 0 : 1;
      const { results } = await db.prepare(`SELECT m.seq, m.sender, m.body, m.sent_at, m.read_at
        FROM friendships f LEFT JOIN friend_messages m
          ON m.first_id = f.first_id AND m.second_id = f.second_id AND m.seq < ?3
        WHERE f.first_id = ?1 AND f.second_id = ?2 AND f.accepted = 1
        ORDER BY m.seq DESC LIMIT ${messagePageSize + 1}`).bind(first, second, before ?? Number.MAX_SAFE_INTEGER).all();
      if (!results.length) return null;
      const rows = results.filter(row => row.seq !== null);
      if (before === undefined && rows.some(row => row.sender !== sender && row.read_at === null)) {
        await db.prepare(`UPDATE friend_messages SET read_at = ?1
          WHERE first_id = ?2 AND second_id = ?3 AND sender = ?4 AND read_at IS NULL AND seq <= ?5`)
          .bind(now, first, second, 1 - sender, rows[0].seq).run();
      }
      return messagePage(rows, sender);
    },
    async sendMessage(self, peer, messageId, body, now) {
      const [first, second] = friendPair(self, peer);
      const sender = self === first ? 0 : 1;
      const row = await db.prepare(`INSERT INTO friend_messages (first_id, second_id, sender, message_id, body, sent_at)
        SELECT first_id, second_id, ?3, ?4, ?5, ?6 FROM friendships WHERE first_id = ?1 AND second_id = ?2 AND accepted = 1
        ON CONFLICT(first_id, second_id, sender, message_id) DO NOTHING RETURNING seq, sender, body, sent_at`)
        .bind(first, second, sender, messageId, body, now).first();
      const existing = row ?? await db.prepare(`SELECT m.seq, m.sender, m.body, m.sent_at FROM friend_messages m
        JOIN friendships f USING(first_id, second_id)
        WHERE m.first_id = ?1 AND m.second_id = ?2 AND m.sender = ?3 AND m.message_id = ?4 AND f.accepted = 1`)
        .bind(first, second, sender, messageId).first();
      if (!existing) return null;
      return existing.body === body ? messageView(existing, sender) : false;
    },
    async add(self, peer, now) {
      const [first, second] = self.account < peer.account ? [self, peer] : [peer, self];
      await db.prepare('INSERT INTO friendships (first_id, second_id, first_name, second_name, requester, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (first_id, second_id) DO NOTHING')
        .bind(first.account, second.account, first.nickname, second.nickname, self.account, now).run();
      const row = await db.prepare('SELECT * FROM friendships WHERE first_id = ? AND second_id = ?').bind(first.account, second.account).first();
      return row ? friendView(row, self.account).status : 'sent';
    },
    async respond(self, peer, response) {
      const pair = friendPair(self, peer);
      if (response === 'accept') {
        const { meta } = await db.prepare('UPDATE friendships SET accepted = 1 WHERE first_id = ?1 AND second_id = ?2 AND requester = ?3 AND accepted = 0')
          .bind(...pair, peer).run();
        return !!meta.changes;
      }
      const statements = {
        decline: 'DELETE FROM friendships WHERE first_id = ? AND second_id = ? AND requester = ? AND accepted = 0',
        remove: 'DELETE FROM friendships WHERE first_id = ? AND second_id = ? AND (requester = ? OR accepted = 1)'
      };
      const { meta } = await db.prepare(statements[response]).bind(...pair, response === 'remove' ? self : peer).run();
      return !!meta.changes;
    }
  };
}

export function memoryFriends() {
  const rows = new Map();
  const messages = new Map();
  const identities = new Map();
  const presence = new Map();
  let sequence = 0;
  return {
    identity(user) { return identities.get(user); },
    bindIdentity(user, guestKey) {
      if (!identities.has(user) && ![...identities.values()].includes(guestKey)) identities.set(user, guestKey);
      return identities.get(user) === guestKey;
    },
    list(self) {
      return [...rows.values()].filter(row => row.first_id === self || row.second_id === self).map(row => {
        const peer = row.first_id === self ? row.second_id : row.first_id;
        const sender = row.first_id === self ? 0 : 1;
        const unread = row.accepted ? messages.get(friendPair(self, peer).join(':'))?.filter(message => message.sender !== sender && !message.read_at).length : 0;
        return friendView({ ...row, unread }, self);
      });
    },
    presence(self, tab, sharing, now) {
      const friends = this.list(self).filter(friend => friend.status === 'friend');
      const tabs = presence.get(self) ?? new Map();
      for (const [account, active] of presence) {
        for (const [id, expiresAt] of active) if (expiresAt <= now) active.delete(id);
        if (!active.size) presence.delete(account);
      }
      if (sharing === 'show' && friends.length) {
        tabs.set(tab, now + friendPresenceLifetime);
        presence.set(self, tabs);
      } else if (sharing === 'hide') {
        tabs.delete(tab);
        if (!tabs.size) presence.delete(self);
      }
      return friends.filter(friend => presence.has(friend.id)).map(({ id, nickname }) => ({ id, nickname }));
    },
    thread(self, peer, before, now) {
      const [first, second] = friendPair(self, peer);
      const key = [first, second].join(':');
      if (!rows.get(key)?.accepted) return null;
      const sender = self === first ? 0 : 1;
      const history = messages.get(key) ?? [];
      if (before === undefined) {
        for (const row of history) if (row.sender !== sender) row.read_at ??= now;
      }
      return messagePage(history.filter(row => before === undefined || row.seq < before).slice(-messagePageSize - 1).reverse(), sender);
    },
    sendMessage(self, peer, messageId, body, now) {
      const [first, second] = friendPair(self, peer);
      const key = [first, second].join(':');
      if (!rows.get(key)?.accepted) return null;
      const sender = self === first ? 0 : 1;
      const history = messages.get(key) ?? [];
      const existing = history.find(row => row.sender === sender && row.message_id === messageId);
      if (existing) return existing.body === body ? messageView(existing, sender) : false;
      const row = { seq: ++sequence, sender, message_id: messageId, body, sent_at: now, read_at: null };
      history.push(row);
      messages.set(key, history);
      return messageView(row, sender);
    },
    add(self, peer) {
      const [first, second] = self.account < peer.account ? [self, peer] : [peer, self];
      const key = `${first.account}:${second.account}`;
      if (!rows.has(key)) rows.set(key, {
        first_id: first.account, second_id: second.account, first_name: first.nickname, second_name: second.nickname,
        requester: self.account, accepted: 0
      });
      return friendView(rows.get(key), self.account).status;
    },
    respond(self, peer, response) {
      const key = friendPair(self, peer).join(':');
      const row = rows.get(key);
      if (!row) return false;
      if (response === 'remove' && (row.requester === self || row.accepted)) return rows.delete(key);
      if (response === 'remove' || row.requester !== peer || row.accepted) return false;
      if (response === 'decline') return rows.delete(key);
      row.accepted = 1;
      return true;
    }
  };
}
