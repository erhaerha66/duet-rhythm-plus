import { getProgress } from '../public/pace.js';

const historyPageSize = 30;

export function recordRound(state, room, now, leaving = false, interruption = 'interrupted') {
  const game = room.game;
  const revision = room.partnerRevision ?? 0;
  if (!state.historyEvents || !game || room.players.length !== 2 || game.historySaved === revision) return;
  if (!leaving && game.finishedAt == null && (game.pausedAt || now < game.startAt + game.seconds * 1000 + 800)) return;
  const progress = getProgress(game, now);
  if (!progress.done && !leaving) return;
  const elapsed = Math.round(progress.elapsed - (game.historyStarted ?? 0));
  if (elapsed <= 0) return;
  game.historySaved = revision;
  const marks = game.marks.map((list, index) => Math.max(0, list.length - (game.historyMarks?.[index] ?? 0)));
  const outcome = !progress.done ? interruption : game.finishedAt != null ? 'ended' : 'completed';
  const endedAt = progress.done ? Math.min(now, game.finishedAt ?? game.startAt + game.seconds * 1000) : now;
  for (const [index, player] of room.players.entries()) {
    if (!player.account) continue;
    const peer = room.players[1 - index];
    state.historyEvents.push({
      player: player.account, segment: game.id + '/' + revision, partner: peer.account ?? peer.id, partnerName: peer.nickname || '匿名玩家',
      role: index === room.controller ? 'controller' : 'receiver', mode: room.kind,
      elapsed, marks: marks[index], partnerMarks: marks[1 - index], endedAt, outcome
    });
  }
}

const historyFields = 'seq, partner, partner_name AS partnerName, role, mode, elapsed, marks, partner_marks AS partnerMarks, ended_at AS endedAt, outcome';

function historyPage(rows) {
  return { items: rows.slice(0, historyPageSize), hasMore: rows.length > historyPageSize };
}

export function databaseHistory(db) {
  return {
    write(events, guardLobbyWrite = true) {
      return db.prepare(`INSERT OR IGNORE INTO round_history
        (player, segment, partner, partner_name, role, mode, elapsed, marks, partner_marks, ended_at, outcome)
        SELECT json_extract(value, '$.player'), json_extract(value, '$.segment'), json_extract(value, '$.partner'),
          json_extract(value, '$.partnerName'), json_extract(value, '$.role'), json_extract(value, '$.mode'),
          json_extract(value, '$.elapsed'), json_extract(value, '$.marks'), json_extract(value, '$.partnerMarks'),
          json_extract(value, '$.endedAt'), json_extract(value, '$.outcome')
        FROM json_each(?) ${guardLobbyWrite ? 'WHERE changes() > 0' : ''}`).bind(JSON.stringify(events));
    },
    async recoverPausedRounds(player, cutoff, membershipCutoff) {
      const { results } = await db.prepare(`WITH rooms AS (
          SELECT value AS room FROM lobby_state, json_each(payload, '$.rooms') WHERE lobby_state.id = 1
        ) SELECT room FROM rooms
        WHERE json_extract(room, '$.closedAt') IS NULL AND json_array_length(room, '$.players') = 2
          AND (?1 IS NULL OR ?1 IN (json_extract(room, '$.players[0].account'), json_extract(room, '$.players[1].account')))
          AND json_extract(room, '$.players[0].seen') > ?2 AND json_extract(room, '$.players[1].seen') > ?2
          AND json_extract(room, '$.game.startAt') <= ?3
          AND NOT EXISTS (SELECT 1 FROM round_history WHERE player = ?1 AND segment =
            json_extract(room, '$.game.id') || '/' || COALESCE(json_extract(room, '$.partnerRevision'), 0))`)
        .bind(player, membershipCutoff, cutoff).all();
      const state = { historyEvents: [] };
      for (const row of results) recordRound(state, JSON.parse(row.room), cutoff, true, 'shutdown');
      if (state.historyEvents.length) await this.write(state.historyEvents, false).run();
    },
    partnerFor(player, seq) {
      return db.prepare(`SELECT own.partner, own.partner_name AS partnerName, peer.partner_name AS selfName
        FROM round_history own LEFT JOIN round_history peer ON peer.player = own.partner AND peer.segment = own.segment
        WHERE own.player = ? AND own.seq = ?`).bind(player, seq).first();
    },
    async list(player, view, search, beforeAt, beforeSeq) {
      const needle = search.toLowerCase();
      if (view === 'partners') {
        const { results } = await db.prepare(`WITH partners AS (
          SELECT partner_name AS partnerName, ended_at AS endedAt, seq, partner,
            COUNT(*) OVER (PARTITION BY partner) AS rounds,
            ROW_NUMBER() OVER (PARTITION BY partner ORDER BY ended_at DESC, seq DESC) AS rank
          FROM round_history WHERE player = ?1
        ) SELECT partnerName, endedAt, seq, rounds, partner FROM partners
          WHERE rank = 1 AND instr(lower(partnerName), ?2) > 0 AND (endedAt, seq) < (?3, ?4)
          ORDER BY endedAt DESC, seq DESC LIMIT ${historyPageSize + 1}`)
          .bind(player, needle, beforeAt, beforeSeq).all();
        return historyPage(results);
      }
      const { results } = await db.prepare(`SELECT ${historyFields} FROM round_history
        WHERE player = ?1 AND instr(lower(partner_name), ?2) > 0 AND (ended_at, seq) < (?3, ?4)
        ORDER BY ended_at DESC, seq DESC LIMIT ${historyPageSize + 1}`)
        .bind(player, needle, beforeAt, beforeSeq).all();
      return historyPage(results);
    }
  };
}

export function memoryHistory() {
  const records = [];
  return {
    save(events) {
      for (const event of events) {
        if (!records.some(row => row.player === event.player && row.segment === event.segment)) records.push({ ...event, seq: records.length + 1 });
      }
    },
    partnerFor(player, seq) {
      const row = records.find(record => record.player === player && record.seq === seq);
      if (!row) return;
      const peer = records.find(record => record.player === row.partner && record.segment === row.segment);
      return { partner: row.partner, partnerName: row.partnerName, selfName: peer?.partnerName };
    },
    list(player, view, search, beforeAt, beforeSeq) {
      const latest = records.filter(row => row.player === player).sort((a, b) => b.endedAt - a.endedAt || b.seq - a.seq);
      const peers = new Map();
      if (view === 'partners') for (const row of latest) {
        if (!peers.has(row.partner)) peers.set(row.partner, { partner: row.partner, partnerName: row.partnerName, endedAt: row.endedAt, seq: row.seq, rounds: 0 });
        peers.get(row.partner).rounds += 1;
      }
      const rows = view === 'partners' ? [...peers.values()] : latest;
      return historyPage(rows.filter(row => row.partnerName.toLowerCase().includes(search.toLowerCase()) &&
        (row.endedAt < beforeAt || (row.endedAt === beforeAt && row.seq < beforeSeq)))
        .map(({ player: _, segment: _segment, ...row }) => row));
    }
  };
}
