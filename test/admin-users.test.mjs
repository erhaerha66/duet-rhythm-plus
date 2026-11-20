import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { adminUsersApi } from '../server/admin-users.mjs';
import { guestAccount } from '../server/game.mjs';

test('admin user data covers archived sources and linked identities without exposing credentials', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const path = new URL('../drizzle/', import.meta.url);
  for (const file of (await readdir(path)).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(await readFile(new URL(file, path), 'utf8'));
  }
  const db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      const bind = (...params) => {
        const all = () => ({ results: stmt.all(...params) });
        const run = () => ({ meta: stmt.run(...params) });
        return { all, run, execute: () => stmt.columns().length ? all() : run() };
      };
      return { ...bind(), bind };
    },
    batch: statements => statements.map(statement => statement.execute())
  };
  const key = 'a'.repeat(64);
  const account = await guestAccount(key);
  const partner = await guestAccount('b'.repeat(64));
  const orphan = await guestAccount('d'.repeat(64));
  const linkedKey = 'e'.repeat(64);
  const linkedAccount = await guestAccount(linkedKey);
  const viewer = await guestAccount('f'.repeat(64));
  const snapshot = JSON.stringify({ online: {
    [account]: { account, nickname: '在线昵称', seen: 180, publicGender: 'man', profile: { role: 'controller', voice: 'any' } }
  }, queue: [], rooms: { ABCDEF: { players: [], watch: { viewers: [{ account: viewer, nickname: '访客观众', seen: 177 }] } } } });
  sqlite.prepare('UPDATE lobby_state SET payload = ? WHERE id = 1').run(snapshot);
  sqlite.prepare('INSERT INTO friend_identity(user_id, guest_key) VALUES (?, ?), (?, ?)').run('provider-private',key,'linked-only-private',linkedKey);
  sqlite.prepare(`INSERT INTO round_history
    (player, segment, partner, partner_name, role, mode, elapsed, marks, partner_marks, ended_at, outcome)
    VALUES (?, 'round/0', ?, '历史搭档', 'controller', 'friend', 1000, 0, 1, 160, 'shutdown')`).run(account, partner);
  sqlite.prepare(`INSERT INTO friendships (first_id, second_id, first_name, second_name, requester, accepted, created_at)
      VALUES (?, ?, '旧昵称', '历史搭档', ?, 1, 155)`).run(account, partner, account);
  sqlite.prepare(`INSERT INTO friend_messages (first_id, second_id, sender, message_id, body, sent_at)
      VALUES (?, ?, 0, 'msg1', '密文内容不得出现在名单', 173), (?, ?, 1, 'msg2', '无现存好友关系', 172)`)
    .run(account, partner, partner, orphan);
  sqlite.prepare(`INSERT INTO moderation_reports (id, reporter, target, target_name, source, context, reason, detail, created_at)
      VALUES ('report', ?, ?, '在线昵称', 'room', 'context', '其他', '举报详情', 170)`).run(viewer, account);
  sqlite.prepare('INSERT INTO voice_samples (account, audio) VALUES (?, ?)').run(account, new Uint8Array([1,2,3]));

  const settings = { ADMIN_EMAILS: 'moderator@example.test' };
  const admin = { 'oai-authenticated-user-email': 'moderator@example.test', 'oai-authenticated-user-id': 'trusted-session' };
  const request = (path, headers) => adminUsersApi(new Request('https://jianke.test' + path, { headers }), settings, db);
  assert.equal((await request('/api/admin/users')).status, 403);
  assert.equal((await request('/api/admin/users/' + account, { ...admin, 'oai-authenticated-user-email': 'other@example.test' })).status, 403);
  const roster = await (await request('/api/admin/users', admin)).json();
  assert.deepEqual(new Set(roster.items.map(user => user.account)), new Set([account, partner, orphan, linkedAccount, viewer]));
  assert.equal(roster.items[0].nickname, '在线昵称');
  assert.ok(!JSON.stringify(roster).includes(linkedKey));
  const found = await (await request('/api/admin/users?q=在线', admin)).json();
  assert.deepEqual(found.items.map(user => user.account), [account]);
  const prefix = await (await request('/api/admin/users?q=' + linkedAccount.slice(0,12), admin)).json();
  assert.deepEqual(prefix.items.map(user => user.account), [linkedAccount]);
  const record = await (await request('/api/admin/users/' + account, admin)).json();
  assert.equal(record.user.bound, 1);
  assert.equal(record.user.rounds, 1);
  assert.equal(record.user.messagesSent, 1);
  assert.equal(record.user.receivedReports, 1);
  assert.equal(record.user.voiceSample, 1);
  assert.equal(record.user.profile.gender,'man');
  assert.equal(record.friends[0].status,'friend');
  assert.equal(record.reports[0].reason,'其他');
  assert.equal(record.rounds[0].outcome,'shutdown');
  assert.ok(!JSON.stringify(record).includes(key));
  assert.ok(!JSON.stringify(record).includes('密文内容'));
  assert.equal(sqlite.prepare('SELECT payload FROM lobby_state').get().payload,snapshot);

  const withMore = sqlite.prepare('INSERT INTO voice_samples (account, audio) VALUES (?, ?)');
  for (let index = 0; index < 31; index++) withMore.run(index.toString(16).padStart(64,'0'), new Uint8Array([1]));
  const first = await (await request('/api/admin/users', admin)).json();
  const last = first.items.at(-1);
  const second = await (await request(`/api/admin/users?after=${last.account}&at=${last.activityAt}`, admin)).json();
  assert.equal(first.hasMore,true);
  assert.equal(second.hasMore,false);
  assert.equal(new Set([...first.items,...second.items].map(row => row.account)).size,36);
});
