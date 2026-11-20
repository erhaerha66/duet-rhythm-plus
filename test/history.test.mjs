import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { api, databaseStore, guestAccount, memoryStore } from '../server/game.mjs';
import { memoryFriends } from '../server/friends.mjs';
import { databaseHistory, memoryHistory } from '../server/history.mjs';
import { getProgress } from '../public/pace.js';

const pauseAt = 1_000_000;
const historyFriends = memoryFriends();

function client(store, key, nickname, role, archiveOnly = false) {
  const id = crypto.randomUUID();
  const guestKey = key.repeat(64);
  return async (action, values = {}, expected = 200) => {
    const response = await api(new Request('https://jianke.test/api/room', {
      method: 'POST', body: JSON.stringify({ id, guestKey, adult: true, nickname, profile: { role }, action, ...values })
    }), store, {}, historyFriends, undefined, undefined, undefined, undefined, archiveOnly, pauseAt);
    assert.equal(response.status, expected, `${action}: ${await response.clone().text()}`);
    return response.json();
  };
}

async function startRound(host, peer, seconds = 60) {
  const { room: { code } } = await host('create', { seconds });
  await peer('join', { code });
  await host('ready', { code, ready: true });
  const { room: { game } } = await peer('ready', { code, ready: true });
  return { code, game };
}

test('database history is private, survives rejoining and only records a committed round once', async t => {
  let now = 200_000;
  t.mock.method(Date, 'now', () => now);
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  for (const migration of ['0000_lobby', '0009_round_history']) {
    sqlite.exec(await readFile(new URL(`../drizzle/${migration}.sql`, import.meta.url), 'utf8'));
  }
  let simulateRace = true;
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bind = (...args) => ({
        first: () => statement.get(...args),
        all: () => ({ results: statement.all(...args) }),
        run: () => ({ meta: statement.run(...args) })
      });
      return { ...bind(), bind };
    },
    async batch(statements) {
      if (simulateRace) {
        simulateRace = false;
        const { payload } = sqlite.prepare('SELECT payload FROM lobby_state WHERE id = 1').get();
        const state = JSON.parse(payload);
        Object.values(state.rooms)[0].race = true;
        sqlite.prepare('UPDATE lobby_state SET payload = ? WHERE id = 1').run(JSON.stringify(state));
      }
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => statement.run());
        assert.equal(results[1].meta.changes, results[0].meta.changes ? 2 : 0);
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
  const store = databaseStore(db, databaseHistory(db));
  const host = client(store, 'a', '小节拍', 'controller');
  const peer = client(store, 'b', '小乐', 'receiver');
  const outsider = client(store, 'c', '陌生人');
  const { code, game } = await startRound(host, peer);
  const round = { code, round: game.id };
  now = game.startAt + 500;
  const stop = (await host('interaction', { ...round, kind: 'stop-for', value: 10 })).room.game;
  await peer('mark', { ...round, index: getProgress(stop, now).index });
  assert.deepEqual((await peer('history', { view: 'rounds' })).items, []);
  now += 3000;
  await peer('interaction', { ...round, kind: 'finish' });
  assert.equal(simulateRace, false);
  const returning = client(store, 'a', '小节拍的新标签页');
  const { items: [theirRound] } = await peer('history', { view: 'rounds' });
  const { items: [myRound] } = await returning('history', { view: 'rounds', search: '小乐' });
  assert.deepEqual(myRound, {
    seq: myRound.seq, partnerName: '小乐', role: 'controller', mode: 'friend', elapsed: 3500,
    marks: 0, partnerMarks: 1, endedAt: now, outcome: 'ended', friendship: 'available'
  });
  assert.equal(theirRound.partnerName, '小节拍');
  assert.deepEqual([theirRound.marks, theirRound.partnerMarks], [1, 0]);
  assert.deepEqual((await outsider('history', { view: 'rounds', account: 'a'.repeat(64) })).items, []);
  await host('leave', { code });
  const { items: [partner] } = await returning('history', { view: 'partners', search: '小乐' });
  assert.deepEqual(partner, { partnerName: '小乐', rounds: 1, seq: myRound.seq, endedAt: now, friendship: 'available' });
  now += 86_400_000;
  await outsider('history-friend-add', { seq: myRound.seq }, 404);
  await returning('history-friend-add', { seq: theirRound.seq }, 404);
  assert.equal((await returning('history-friend-add', { seq: myRound.seq })).friendship, 'sent');
  assert.equal((await returning('history-friend-add', { seq: myRound.seq })).friendship, 'sent');
  assert.equal((await peer('history', { view: 'partners' })).items[0].friendship, 'received');
  await peer('friend-response', { target: await guestAccount('a'.repeat(64)), response: 'accept' });
  assert.equal((await returning('history', { view: 'rounds' })).items[0].friendship, 'friend');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM round_history').get().count, 2);

  now = pauseAt - 10_000;
  const interrupted = await startRound(host, peer);
  now = interrupted.game.startAt + 1000;
  const cue = (await host('interaction', { code: interrupted.code, round: interrupted.game.id, kind: 'stop-for', value: 10 })).room.game;
  await peer('mark', { code: interrupted.code, round: interrupted.game.id, index: getProgress(cue, now).index });
  const liveState = sqlite.prepare('SELECT payload FROM lobby_state').get().payload;
  now = pauseAt + 1_200_000;

  const archiveVisitor = client(store, 'c', '陌生人', 'either', true);
  assert.deepEqual((await archiveVisitor('history', { view: 'rounds' })).items, []);
  const archiveHost = client(store, 'a', '小节拍', 'controller', true);
  const archivePeer = client(store, 'b', '小乐', 'receiver', true);
  const restored = (await archiveHost('history', { view: 'rounds' })).items[0];
  assert.equal(restored.partnerName, '小乐');
  assert.equal(restored.outcome, 'shutdown');
  assert.equal(restored.endedAt, pauseAt);
  assert.equal(restored.elapsed, pauseAt - interrupted.game.startAt);
  assert.equal(restored.partnerMarks, 1);
  assert.equal((await archivePeer('history', { view: 'rounds' })).items[0].marks, 1);
  assert.equal((await archiveHost('history', { view: 'rounds' })).items[0].seq, restored.seq);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM round_history').get().count, 4);
  assert.equal(sqlite.prepare('SELECT payload FROM lobby_state').get().payload, liveState);
});

test('standby replacement splits the recorded playing time and does not inherit stop marks', async t => {
  let now = 200_000;
  t.mock.method(Date, 'now', () => now);
  const store = memoryStore(memoryHistory());
  const host = client(store, 'a', '房主', 'receiver');
  const peer = client(store, 'b', '原搭档', 'controller');
  const standby = client(store, 'c', '候补搭档', 'controller');
  const { code, game } = await startRound(host, peer);
  await host('standby-open', { code, open: true });
  const { standby: [entry] } = await standby('lobby');
  await standby('standby-join', { target: entry.id });
  const round = { code, round: game.id };
  now = game.startAt + 500;
  const stop = (await peer('interaction', { ...round, kind: 'stop-for', value: 10 })).room.game;
  await host('mark', { ...round, index: getProgress(stop, now).index });
  now += 3000;
  await peer('leave', { code });
  const { room: promoted } = await standby('sync', { code });
  const ready = { code, ready: true, partnerRevision: promoted.standby.revision };
  await standby('ready', ready);
  const { room: { game: resumed } } = await host('ready', ready);
  now = resumed.resumeAt + 2000;
  await standby('interaction', { ...round, kind: 'finish' });
  const { items } = await host('history', { view: 'rounds' });
  assert.deepEqual(items.map(({ partnerName, elapsed, marks, outcome }) => [partnerName, elapsed, marks, outcome]), [
    ['候补搭档', 2000, 0, 'ended'], ['原搭档', 3500, 1, 'interrupted']
  ]);
  assert.equal((await standby('history', { view: 'rounds' })).items[0].partnerMarks, 0);
});

test('a round that should expire while both players are disconnected is recorded as interrupted', async t => {
  let now = 200_000;
  t.mock.method(Date, 'now', () => now);
  const store = memoryStore(memoryHistory());
  const host = client(store, 'a', '房主', 'controller');
  const peer = client(store, 'b', '搭档', 'receiver');
  const { game } = await startRound(host, peer, 300);
  now = game.startAt + 400_000;
  const { items: [round] } = await host('history', { view: 'rounds' });
  assert.equal(round.outcome, 'interrupted');
  assert.ok(round.elapsed > 0 && round.elapsed < game.seconds * 1000);
});
