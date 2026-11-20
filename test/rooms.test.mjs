import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { api, databaseStore, memoryStore } from '../server/game.mjs';
import { databaseFriends } from '../server/friends.mjs';
import { defaultRoundLimits, getProgress, plan, roundPhases } from '../public/pace.js';

function clients(store, friends) {
  return function newClient(guestKey) {
    const id = crypto.randomUUID();
    return async (action, values = {}) => {
      const request = new Request('https://jianke.test/api/room', {
        method: 'POST',
        body: JSON.stringify({ id, guestKey, action, adult: true, ...values })
      });
      const response = await api(request, store, {}, friends);
      return { status: response.status, ...await response.json() };
    };
  };
}

test('a bound guest identity returns only to its signed-in account', async () => {
  const store = memoryStore();
  const guestKey = 'ab'.repeat(32);
  const request = async (user, key, origin = 'https://jianke.test') => {
    const headers = { Origin: origin };
    if (user) headers['oai-authenticated-user-id'] = user;
    const response = await api(new Request('https://jianke.test/api/friend-identity', {
      headers, ...(key ? { method: 'POST', body: JSON.stringify({ guestKey: key }) } : {})
    }), store, {});
    return { status: response.status, ...await response.json() };
  };
  assert.equal((await request(null, guestKey)).status, 403);
  assert.equal((await request('account-a', guestKey, 'https://other.test')).status, 403);
  assert.equal((await request('account-a', guestKey)).status, 200);
  assert.equal((await request('account-a')).guestKey, guestKey);
  assert.equal((await request('account-b')).guestKey, undefined);
  assert.equal((await request('account-b', guestKey)).status, 409);
  assert.equal((await request('account-a', 'de'.repeat(32))).status, 409);
});

test('random matching pairs independent visitors and cancellation removes the queued player', async () => {
  const visitor = clients(memoryStore());
  const a = visitor();
  const b = visitor();
  const c = visitor();
  assert.equal((await a('match', { adult: false })).status, 403);
  assert.equal((await a('match')).state, 'queued');
  assert.equal((await a('leave')).state, 'idle');
  assert.equal((await b('match', { nickname: '小满' })).state, 'queued');
  const paired = await c('match', { nickname: '阿青' });
  const room = (await b('sync')).room;
  assert.equal(room.code, paired.room.code);
  assert.deepEqual(room.players.map(player => player.nickname), ['小满', '阿青']);
  assert.equal(room.me, 0);
  assert.equal((await a('sync', { code: room.code })).state, 'closed');
  await c('leave');
  assert.equal((await b('sync', { code: room.code })).state, 'closed');
});

test('a full presence roster or an overloaded heartbeat write still returns the online list', async () => {
  const store = memoryStore();
  await store.change(state => {
    state.online = Object.fromEntries(Array.from({ length: 150 }, (_, index) => [String(index), {
      id: crypto.randomUUID(), account: String(index), seen: Date.now(), nickname: '在线测试',
      published: index === 0, profile: { role: 'either' }
    }]));
  });
  const guestKey = 'f'.repeat(64);
  const visitor = clients(store)(guestKey);
  const full = await visitor('lobby', { compact: true });
  assert.equal(full.status, 200);
  assert.equal(full.presenceDelayed, true);
  assert.equal(full.players[0].nickname, '在线测试');
  assert.equal(full.watchable, undefined);

  const warning = new Error('D1 DB is overloaded.');
  const flakyStore = {
    change(apply) {
      apply({ queue: [], rooms: {} });
      throw warning;
    }
  };
  const retry = await clients(flakyStore)(guestKey)('lobby');
  assert.equal(retry.status, 200);
  assert.equal(retry.presenceDelayed, true);
});

test('matchmaking pairs reciprocal voice preferences and leaves microphone consent off', async () => {
  const visitor = clients(memoryStore());
  const host = visitor();
  const same = visitor();
  const reciprocal = visitor();
  assert.equal((await host('match', { profile: { role: 'controller', voice: 'self' } })).state, 'queued');
  assert.equal((await same('match', { profile: { role: 'receiver', voice: 'self' } })).state, 'queued');
  const found = await reciprocal('match', { profile: { role: 'receiver', voice: 'peer' } });
  assert.equal(found.state, 'room');
  assert.equal(found.room.voicePreference, 'peer');
  assert.equal(found.room.voice, null);
  assert.ok(found.room.players.every(player => !player.mic));
  assert.equal((await host('sync')).room.voicePreference, 'self');
  assert.equal((await same('sync')).state, 'queued');

  for (const voice of ['off', 'both']) {
    const separate = clients(memoryStore());
    const first = separate();
    const flexible = separate();
    const incompatible = separate();
    await first('match', { profile: { role: 'controller', voice } });
    assert.equal((await incompatible('match', { profile: { role: 'receiver', voice: voice === 'off' ? 'both' : 'off' } })).state, 'queued');
    assert.equal((await flexible('match', { profile: { role: 'receiver' } })).room.voicePreference, voice);
  }
});

test('clearing a stale queue releases the same browser identity and rejects late retries', async () => {
  const visitor = clients(memoryStore());
  const original = visitor('a'.repeat(64));
  const reloaded = visitor('a'.repeat(64));
  const stranger = visitor('b'.repeat(64));
  const matchId = crypto.randomUUID();
  assert.equal((await original('match', { matchId })).state, 'queued');
  assert.equal((await reloaded('lobby')).code, 'queue-conflict');
  assert.equal((await stranger('clear-queue')).state, 'queue-cleared');
  assert.equal((await original('sync')).state, 'queued');
  assert.equal((await reloaded('clear-queue')).state, 'queue-cleared');
  assert.equal((await original('match', { matchId })).status, 409);
  const nextMatch = crypto.randomUUID();
  assert.equal((await original('match', { matchId: nextMatch })).state, 'queued');
  await original('leave', { matchId });
  assert.equal((await original('sync')).state, 'queued');
  await original('leave', { matchId: nextMatch });
  assert.equal((await original('sync')).state, 'idle');
  assert.equal((await reloaded('lobby')).state, 'social');
});

test('preferred address is optional in public listings and available to matched partners', async () => {
  const visitor = clients(memoryStore());
  const host = visitor('d'.repeat(64));
  const peer = visitor('e'.repeat(64));
  const profile = { role: 'controller', address: '  小节拍  ' };
  await host('lobby', { visible: true, profile });
  assert.equal((await peer('lobby')).players[0].address, undefined);
  await host('lobby', { visible: true, profile: { ...profile, shareAddress: true } });
  assert.equal((await peer('lobby')).players[0].address, '小节拍');
  await host('match', { profile });
  const found = await peer('match', { profile: { role: 'receiver', address: '小乐' } });
  assert.deepEqual(found.room.players.map(player => player.address), ['小节拍', '小乐']);
  assert.equal((await host('sync', { code: found.room.code })).room.players[1].address, '小乐');
});

test('random matching recovers a temporarily disconnected player and keeps a recently matched room', async t => {
  let now = 200_000;
  t.mock.method(Date, 'now', () => now);
  const visitor = clients(memoryStore());
  const a = visitor('a'.repeat(64));
  const b = visitor('b'.repeat(64));
  assert.equal((await a('match')).state, 'queued');
  now += 45_000;
  assert.equal((await b('match')).state, 'queued');
  const paired = await a('sync');
  assert.equal(paired.state, 'room');
  const { code } = paired.room;
  assert.equal((await b('sync', { code })).room.code, code);
  now += 45_000;
  assert.equal((await a('sync', { code })).room.code, code);
  assert.equal((await b('sync', { code })).room.code, code);
  await b('leave');
  assert.equal((await a('sync', { code })).state, 'closed');
});

test('random matching can fill a compatible seat when the waiting queue is full', async () => {
  const store = memoryStore();
  const now = Date.now();
  store.change(state => {
    state.queue = Array.from({ length: 100 }, (_, i) => ({ id: crypto.randomUUID(), seen: now - i,
      profile: { role: 'controller' }, ready: false, mic: false }));
  });
  const join = clients(store)();
  const paired = await join('match', { profile: { role: 'receiver' } });
  assert.equal(paired.state, 'room');
  assert.equal(paired.room.players.length, 2);
});

test('friend room shares cues, pause and resume, and deduplicates stop marks', async t => {
  let now = 20_000;
  t.mock.method(Date, 'now', () => now);
  const visitor = clients(memoryStore());
  const host = visitor();
  const guest = visitor();
  const outsider = visitor();
  const { room: { code } } = await host('create', { seconds: 60, difficulty: 'hard' });
  assert.equal((await guest('join', { code })).room.players.length, 2);
  assert.equal((await outsider('join', { code })).status, 409);
  assert.equal((await host('ready', { code, ready: true })).room.game, null);
  const started = (await guest('ready', { code, ready: true })).room.game;
  assert.deepEqual((await host('sync', { code })).room.game, started);
  assert.equal(started.startAt, now + 2500);

  const index = started.phases.findIndex(phase => phase.kind === 'stop');
  now = started.startAt + started.phases[index - 1].end + 100;
  await host('sync', { code });
  await guest('sync', { code });
  const first = (await guest('mark', { code, round: started.id, index })).room.game;
  const duplicate = (await guest('mark', { code, round: started.id, index })).room.game;
  assert.deepEqual(first.marks, [[], [index]]);
  assert.deepEqual(first.marks, duplicate.marks);
  const paused = (await guest('pause', { code })).room.game;
  assert.equal(paused.pausedAt, now);
  now += 1000;
  await host('ready', { code, ready: true });
  const resumed = (await guest('ready', { code, ready: true })).room.game;
  assert.equal(resumed.pausedAt, null);
  assert.equal(resumed.resumeAt, now + 2500);
  assert.equal(getProgress(paused, now).elapsed, getProgress(resumed, now).elapsed);
});

test('voice offers, answers, and ICE candidates reach only the intended room member', async () => {
  const visitor = clients(memoryStore());
  const a = visitor();
  const b = visitor();
  const outsider = visitor();
  await a('match');
  const { room: { code } } = await b('match');
  assert.deepEqual((await a('sync')).room.players.map(player => player.mic), [false, false]);
  assert.equal((await b('mic', { code, on: true })).status, 403);
  const firstRequest = (await a('voice-request')).room.voice;
  assert.equal(firstRequest.status, 'pending');
  assert.equal((await a('voice-response', { voiceId: firstRequest.id, response: 'accept' })).status, 403);
  const offer = { description: { type: 'offer', sdp: 'v=0' } };
  assert.equal((await a('signal', { code, voiceId: firstRequest.id, data: offer })).status, 403);
  assert.equal((await b('voice-response', { voiceId: firstRequest.id, response: 'decline' })).room.voice.status, 'declined');
  const { id: voiceId } = (await a('voice-request')).room.voice;
  assert.equal((await b('voice-response', { voiceId: firstRequest.id, response: 'accept' })).status, 409);
  assert.equal((await b('voice-response', { voiceId, response: 'accept' })).room.voice.status, 'approved');
  assert.deepEqual((await a('sync')).room.players.map(player => player.mic), [false, false]);
  await b('mic', { code, voiceId, on: true });
  assert.deepEqual((await a('sync')).room.players.map(player => player.mic), [false, true]);
  await a('signal', { code, voiceId, data: offer });
  const candidate = { candidate: { candidate: 'test-candidate', sdpMid: '0' } };
  await a('signal', { code, voiceId, data: candidate });
  assert.deepEqual((await b('sync', { code })).signals, [{ seq: 1, data: offer }, { seq: 2, data: candidate }]);
  assert.deepEqual((await b('sync', { code, after: 2 })).signals, []);
  assert.deepEqual((await a('sync', { code })).signals, []);
  assert.equal((await outsider('sync', { code })).state, 'closed');
  const answer = { description: { type: 'answer', sdp: 'v=0' } };
  await b('signal', { code, voiceId, data: answer });
  assert.deepEqual((await a('sync')).signals, [{ seq: 3, data: answer }]);
  await b('mic', { code, voiceId, on: false, after: 2 });
  assert.equal((await a('sync')).room.players[1].mic, false);
  await b('mic', { code, voiceId, on: true });
  await a('voice-close', { voiceId });
  const revoked = await b('sync');
  assert.equal(revoked.room.voice, null);
  assert.deepEqual(revoked.room.players.map(player => player.mic), [false, false]);
  assert.deepEqual(revoked.signals, []);
  assert.equal((await b('signal', { code, voiceId, data: offer })).status, 403);
});

test('online invitations and reciprocal friendships respect lobby visibility and guest identities', async t => {
  let now = 100_000;
  t.mock.method(Date, 'now', () => now);
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  for (const file of ['0000_lobby.sql', '0001_friendships.sql', '0005_friend_messages.sql', '0006_friend_daily_limit.sql']) {
    sqlite.exec(await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8'));
  }
  sqlite.exec(await readFile(new URL('../drizzle/0012_remove_friend_daily_limit.sql', import.meta.url), 'utf8'));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'trigger' AND name IN ('enforce_friend_daily_limit', 'count_friend_daily_add')").get().count, 0);
  const db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      const bind = (...values) => ({
        first: async () => stmt.get(...values),
        all: async () => ({ results: stmt.all(...values) }),
        run: async () => ({ meta: stmt.run(...values) })
      });
      return { ...bind(), bind };
    }
  };
  const friendStore = databaseFriends(db);
  const visitor = clients(databaseStore(db), friendStore);
  const aliceKey = 'a'.repeat(64);
  const bobKey = 'b'.repeat(64);
  const alice = visitor(aliceKey);
  const bob = visitor(bobKey);
  const outsider = visitor('c'.repeat(64));
  const aliceProfile = { nickname: '小满', visible: true, profile: { role: 'controller', gender: 'woman' } };
  const bobProfile = { nickname: '阿青', profile: { role: 'receiver', orientation: 'gay' } };
  assert.equal((await alice('lobby', { adult: false })).status, 403);
  assert.deepEqual((await alice('lobby', aliceProfile)).players, []);
  const { players: [card] } = await bob('lobby', bobProfile);
  assert.deepEqual(card, { id: card.id, nickname: '小满', role: 'controller', gender: 'unspecified', limits: defaultRoundLimits, compatible: true });
  assert.deepEqual((await alice('lobby', aliceProfile)).players, []);
  assert.equal((await outsider('invite', { ...aliceProfile, target: card.id })).status, 409);
  await bob('invite', { ...bobProfile, target: card.id });
  const [invite] = (await alice('lobby', aliceProfile)).incoming;
  assert.equal(invite.nickname, '阿青');
  assert.equal((await outsider('invite-response', { invite: invite.id, response: 'accept' })).status, 409);
  assert.equal((await bob('sync')).state, 'idle');
  await alice('invite-response', { ...aliceProfile, invite: invite.id, response: 'decline' });
  assert.equal((await bob('lobby', bobProfile)).outgoing, null);
  await bob('invite', { ...bobProfile, target: card.id });
  const [secondInvite] = (await alice('lobby', aliceProfile)).incoming;
  const { room } = await alice('invite-response', { ...aliceProfile, invite: secondInvite.id, response: 'accept' });
  const { code } = room;
  assert.equal((await bob('lobby', bobProfile)).room.code, code);
  assert.equal((await outsider('lobby')).players.some(player => player.id === card.id), false);
  await alice('ready', { ready: true });
  const { room: { game } } = await bob('ready', { ready: true });
  const round = game.id;
  assert.equal((await alice('friend-add', { code, round })).status, 409);
  now = game.startAt + 1000;
  await bob('interaction', { kind: 'finish', round });
  await bob('leave');
  assert.equal((await alice('sync', { code })).lastRound.round, round);
  assert.equal((await outsider('friend-add', { code, round, account: card.id })).status, 403);
  assert.equal((await alice('friend-add', { code, round })).friendship, 'sent');
  assert.equal((await alice('friend-add', { code, round })).friendship, 'sent');
  const bReturns = visitor(bobKey);
  const [request] = (await bReturns('lobby', bobProfile)).friends;
  assert.equal(request.status, 'received');
  assert.equal(request.id, card.id);
  const aReturns = visitor(aliceKey);
  const [outgoing] = (await aReturns('lobby', { ...aliceProfile, visible: false })).friends;
  const directMessage = { target: request.id, messageId: crypto.randomUUID(), message: '今晚见' };
  assert.equal((await bReturns('friend-message', directMessage)).status, 403);
  assert.equal((await bReturns('friend-chat', { target: request.id })).status, 403);
  assert.equal((await aReturns('friend-response', { target: outgoing.id, response: 'accept' })).status, 409);
  assert.equal((await bReturns('friend-response', { target: request.id, response: 'accept' })).friendship, 'accept');
  const friends = await bReturns('lobby', bobProfile);
  assert.equal(friends.players.length, 0);
  assert.equal(friends.friends[0].status, 'friend');
  assert.equal(friends.friends[0].online, true);
  assert.equal((await bReturns('invite', { ...bobProfile, target: request.id })).outgoing, request.id);
  now += 46_000;
  assert.equal((await bReturns('lobby', bobProfile)).outgoing, null);
  assert.equal((await bReturns('lobby', bobProfile)).friends[0].online, false);
  const sent = await bReturns('friend-message', directMessage);
  assert.equal(sent.message.text, directMessage.message);
  assert.equal(sent.message.mine, true);
  assert.deepEqual((await bReturns('friend-message', directMessage)).message, sent.message);
  assert.equal((await bReturns('friend-message', { ...directMessage, message: '重复编号' })).status, 409);
  assert.equal((await outsider('friend-chat', { target: request.id })).status, 403);
  assert.equal((await aReturns('lobby')).friends[0].unread, 1);
  const thread = await aReturns('friend-chat', { target: outgoing.id });
  assert.deepEqual(thread.messages, [{ ...sent.message, mine: false }]);
  assert.equal((await aReturns('lobby')).friends[0].unread, undefined);
  assert.deepEqual((await aReturns('friend-chat', { target: outgoing.id, before: sent.message.seq })).messages, []);
  assert.equal((await bReturns('friend-response', { target: request.id, response: 'remove' })).status, 200);
  assert.equal((await aReturns('friend-chat', { target: outgoing.id })).status, 403);
  assert.deepEqual((await aReturns('lobby', { ...aliceProfile, visible: false })).friends, []);

  now = Date.UTC(2026, 0, 1, 15, 59, 59);
  const { id: aliceAccount } = card;
  const day = Math.floor((now + 8 * 60 * 60 * 1000) / 86_400_000);
  sqlite.prepare('INSERT INTO friend_daily_adds (day, account, total) VALUES (?, ?, 2)').run(day, aliceAccount);
  const accountFor = async key => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))).toString('hex');
  const keys = ['d', 'e', 'f'].map(character => character.repeat(64));
  const accounts = await Promise.all(keys.map(accountFor));
  for (const account of accounts) {
    await friendStore.add({ account: aliceAccount, nickname: '小满' }, { account, nickname: '好友' }, now);
  }
  const accepting = keys.map(visitor);
  const accepted = await Promise.all(accepting.map(friend => friend('friend-response', { target: aliceAccount, response: 'accept' })));
  assert.deepEqual(accepted.map(reply => reply.status), [200, 200, 200]);
  assert.equal((await accepting[0]('friend-response', { target: aliceAccount, response: 'accept' })).status, 409);
  assert.equal((await aReturns('lobby')).friends.filter(friend => friend.status === 'friend').length, 3);
});

test('database writes preserve both players under concurrent matching and room sync', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(new URL('../drizzle/0000_lobby.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        first: async () => statement.get(),
        bind: (...values) => ({ first: async () => statement.get(...values), run: async () => ({ meta: statement.run(...values) }) })
      };
    }
  };
  try {
    const visitor = clients(databaseStore(db));
    const a = visitor('a'.repeat(64));
    const b = visitor();
    const match = { matchId: crypto.randomUUID() };
    assert.equal((await a('match', match)).state, 'queued');
    const beforeHeartbeat = sqlite.prepare('SELECT revision FROM lobby_state').get().revision;
    assert.equal((await a('match', { ...match, queueHeartbeat: true })).state, 'queued');
    assert.equal(sqlite.prepare('SELECT revision FROM lobby_state').get().revision, beforeHeartbeat);
    const results = await Promise.all([a('match', { ...match, queueHeartbeat: true }), b('match')]);
    assert.equal(results[1].state, 'room');
    assert.ok(['queued', 'room'].includes(results[0].state));
    assert.equal((await a('match', { ...match, queueHeartbeat: true })).state, 'room');
    const [first, second] = await Promise.all([a('sync'), b('sync')]);
    assert.equal(first.room.code, second.room.code);
    assert.deepEqual([first.room.me, second.room.me].sort(), [0, 1]);
    const other = visitor();
    const { room: { code: otherCode } } = await other('create');
    now += 15_000;
    const code = first.room.code;
    const before = sqlite.prepare('SELECT revision FROM lobby_state').get().revision;
    const updated = await Promise.all([a('sync', { code }), b('sync', { code }), other('sync', { code: otherCode })]);
    assert.deepEqual(updated.map(value => value.room.code), [code, code, otherCode]);
    const updatedRow = sqlite.prepare('SELECT revision, payload FROM lobby_state').get();
    assert.equal(updatedRow.revision, before);
    const state = JSON.parse(updatedRow.payload);
    assert.ok(Object.values(state.rooms).flatMap(room => room.players).every(player => player.seen === now));
    now += 15_000;
    const next = visitor();
    await Promise.all([a('sync', { code }), other('sync', { code: otherCode }), next('match')]);
    const merged = JSON.parse(sqlite.prepare('SELECT payload FROM lobby_state').get().payload);
    assert.equal(merged.queue.length, 1);
    assert.equal(merged.rooms[code].players[first.room.me].seen, now);
    assert.equal(merged.rooms[otherCode].players[0].seen, now);
    const online = visitor('e'.repeat(64));
    await online('lobby', { visible: true, nickname: '在线玩家' });
    const presenceRevision = sqlite.prepare('SELECT revision FROM lobby_state').get().revision;
    now += 15_000;
    await online('lobby', { visible: true, nickname: '在线玩家' });
    assert.equal(sqlite.prepare('SELECT revision FROM lobby_state').get().revision, presenceRevision);
    now += 15_000;
    const newcomer = visitor();
    await Promise.all([online('lobby', { visible: true, nickname: '在线玩家' }), newcomer('create')]);
    const withPresence = JSON.parse(sqlite.prepare('SELECT payload FROM lobby_state').get().payload);
    assert.equal(Object.values(withPresence.online).find(player => player.nickname === '在线玩家').seen, now);
  } finally {
    sqlite.close();
  }
});

test('standby promotes players in queue order and preserves the room and the round clock', async t => {
  let now = 200_000;
  t.mock.method(Date, 'now', () => now);
  const visitor = clients(memoryStore());
  const [host, departing, first, second, wrongRole] = ['1', '2', '3', '4', '5'].map(value => visitor(value.repeat(64)));
  const controller = { profile: { role: 'controller' } };
  const receiver = { profile: { role: 'receiver' } };
  const { room: { code } } = await host('create', { ...controller, seconds: 60, nickname: '房主' });
  await departing('join', { ...receiver, code, nickname: '原玩家' });
  assert.deepEqual((await first('lobby', receiver)).standby, []);
  await host('standby-open', { open: true });
  const [listing] = (await first('lobby', receiver)).standby;
  assert.deepEqual(listing, { id: listing.id, nickname: '房主', role: 'controller', gender: 'unspecified', limits: defaultRoundLimits, compatible: true, vacant: false, waiting: 0 });
  assert.equal((await wrongRole('standby-join', { ...controller, target: listing.id })).status, 409);
  assert.equal((await first('standby-join', { ...receiver, target: listing.id, nickname: '候补一' })).standby.position, 1);
  assert.equal((await second('standby-join', { ...receiver, target: listing.id, nickname: '候补二' })).standby.position, 2);
  now += 20_000;
  await host('sync');
  await departing('sync');
  now += 18_000;
  const retried = await first('standby-join', { ...receiver, target: listing.id });
  assert.equal(retried.standby.position, 1);
  assert.equal(retried.standby.code, code);
  assert.equal((await second('sync', { standbyCode: code })).standby.position, 2);
  assert.equal((await host('sync')).room.standby.waiting, 2);
  await host('ready', { ready: true });
  const { room: { game } } = await departing('ready', { ready: true });
  now = game.startAt + 5000;
  const { room: { voice } } = await host('voice-request');
  await departing('voice-response', { voiceId: voice.id, response: 'accept' });
  await departing('mic', { voiceId: voice.id, on: true });
  await departing('interaction', { kind: 'reply', value: 'stronger', round: game.id });
  await departing('leave');
  assert.equal((await departing('sync', { code })).state, 'closed');
  const promoted = (await first('sync')).room;
  assert.equal(promoted.code, code);
  assert.equal(promoted.controller, 0);
  assert.deepEqual(promoted.players.map(player => player.nickname), ['房主', '候补一']);
  assert.deepEqual(promoted.players.map(player => player.ready || player.mic), [false, false]);
  assert.equal(promoted.voice, null);
  assert.equal(promoted.game.reply, undefined);
  assert.equal(promoted.game.pausedAt, now);
  assert.equal(getProgress(promoted.game, now).elapsed, 5000);
  assert.equal((await second('sync')).standby.position, 1);
  assert.equal((await host('mic', { voiceId: voice.id, on: true })).status, 403);

  assert.equal((await host('ready', { ready: true })).status, 409);
  await first('ready', { ready: true, partnerRevision: promoted.standby.revision });
  assert.equal((await host('sync')).room.game.pausedAt, now);
  now += 500;
  const resumed = (await host('ready', { ready: true, partnerRevision: promoted.standby.revision })).room.game;
  assert.equal(resumed.id, game.id);
  assert.equal(resumed.pausedAt, null);
  assert.equal(getProgress(resumed, now).elapsed, 5000);
  now += 20_000;
  await host('sync');
  await second('sync');
  now += 11_000;
  const timeout = (await host('sync')).room;
  assert.equal(timeout.code, code);
  assert.equal(timeout.players[1].nickname, '候补二');
  assert.equal((await second('sync')).room.game.pausedAt, now);
});

test('an empty standby seat can be filled and a completed round still targets its former partner', async t => {
  let now = 200_000;
  t.mock.method(Date, 'now', () => now);
  const visitor = clients(memoryStore());
  const [host, guest, replacement] = ['6', '7', '8'].map(value => visitor(value.repeat(64)));
  const controller = { profile: { role: 'controller' } };
  const receiver = { profile: { role: 'receiver' } };
  const { room: { code } } = await host('create', { ...receiver, nickname: '留在房间的人' });
  await guest('join', { ...controller, code, nickname: '上一位玩家' });
  await host('standby-open', { open: true });
  await host('ready', { ready: true });
  const { room: { game } } = await guest('ready', { ready: true });
  now = game.startAt + 1500;
  await guest('interaction', { kind: 'finish', round: game.id });
  await guest('leave');
  const alone = (await host('sync')).room;
  assert.equal(alone.standby.vacant, true);
  assert.equal(alone.waitingRole, 'receiver');
  assert.equal(alone.previousRound.nickname, '上一位玩家');
  const [listing] = (await replacement('lobby', controller)).standby;
  assert.equal(listing.vacant, true);
  const entered = (await replacement('standby-join', { ...controller, target: listing.id })).room;
  assert.equal(entered.code, code);
  assert.equal(entered.me, entered.controller);
  assert.equal(entered.previousRound, undefined);
  assert.equal(entered.game, null);
  assert.equal((await host('friend-add', { code, round: game.id })).friendship, 'sent');
  await replacement('leave');
  await host('standby-open', { open: false });
  assert.deepEqual((await guest('lobby', controller)).standby, []);
});

test('each cue plan covers the full duration and uses all three cues', () => {
  for (const level of ['easy', 'normal', 'hard']) {
    const phases = plan(60, level);
    assert.equal(phases.at(-1).end, 60_000);
    assert.deepEqual([...new Set(phases.map(phase => phase.kind))].sort(), ['fast', 'slow', 'stop']);
    assert.equal(phases.every((phase, index) => index === 0 || phase.end > phases[index - 1].end), true);
  }
});

test('random matching checks both players’ gender filters and complementary roles', async () => {
  const visitor = clients(memoryStore());
  const host = visitor();
  const incompatible = visitor();
  const sameRole = visitor();
  const compatible = visitor();
  const profile = (gender, orientation, role) => ({ gender, orientation, role, target: 'auto' });
  assert.equal((await host('match', { profile: profile('woman', 'straight', 'controller') })).state, 'queued');
  assert.equal((await incompatible('match', { profile: profile('man', 'gay', 'receiver') })).state, 'queued');
  assert.equal((await sameRole('match', { profile: profile('man', 'straight', 'controller') })).state, 'queued');
  const { room } = await compatible('match', { profile: profile('man', 'straight', 'receiver') });
  assert.equal(room.controller, 0);
  assert.equal(room.me, 1);
  assert.deepEqual(Object.keys(room.players[0]).sort(), ['mic', 'nickname', 'ready']);
  assert.equal((await host('sync')).room.code, room.code);
  assert.equal((await incompatible('sync')).state, 'queued');
  assert.equal((await sameRole('sync')).state, 'queued');
});

test('friend room assigns explicit roles and authorizes only the controller to send manual cues', async t => {
  let now = 100_000;
  t.mock.method(Date, 'now', () => now);
  const visitor = clients(memoryStore());
  const host = visitor();
  const guest = visitor();
  const { room: { code } } = await host('create', { profile: { role: 'receiver' } });
  assert.equal((await guest('join', { code, profile: { role: 'receiver' } })).status, 409);
  const { room } = await guest('join', { code, profile: { role: 'controller' } });
  assert.equal(room.controller, 1);
  await host('ready', { code, ready: true });
  const { room: { game } } = await guest('ready', { code, ready: true });
  const round = game.id;
  assert.equal((await guest('cue', { round, cue: 'stop' })).status, 409);
  now = game.startAt + 1000;
  assert.equal((await host('cue', { round, cue: 'stop' })).status, 403);
  assert.equal((await guest('cue', { round, cue: 'unknown' })).status, 400);
  const command = (await guest('cue', { round, cue: 'stop' })).room.game;
  assert.equal(command.liveCue.kind, 'stop');
  const index = command.liveCue.id;
  const current = (await host('sync')).room.game;
  assert.equal(getProgress(current, now).index, index);
  assert.equal(getProgress(current, now).phaseStart, 1000);
  assert.deepEqual((await guest('mark', { round, index })).room.game.marks, [[], []]);
  assert.deepEqual((await host('mark', { round, index })).room.game.marks, [[index], []]);
  assert.deepEqual((await host('mark', { round, index })).room.game.marks, [[index], []]);
  assert.equal((await guest('cue', { round, cue: 'stop' })).room.game.liveCue.id, index);
  assert.equal((await guest('cue', { round, cue: 'auto' })).room.game.liveCue, null);
  assert.equal(getProgress((await host('sync')).room.game, now).phase.kind, 'fast');
  await host('pause');
  assert.equal((await guest('cue', { round, cue: 'slow' })).status, 409);
});

test('online cards publish only the selected gender and rooms enforce both players’ limits', async t => {
  let now = 100_000;
  t.mock.method(Date, 'now', () => now);
  const visitor = clients(memoryStore());
  const host = visitor('a'.repeat(64));
  const peer = visitor('b'.repeat(64));
  const hostValues = { nickname: '小满', visible: true, profile: { role: 'controller', gender: 'woman', orientation: 'bi' },
    limits: { minMinutes: 8, maxMinutes: 18, maxIntensity: 4 } };
  const peerValues = { profile: { role: 'receiver' }, limits: { minMinutes: 12, maxMinutes: 15, maxIntensity: 2 } };
  await host('lobby', hostValues);
  let [card] = (await peer('lobby', peerValues)).players;
  assert.equal(card.gender, 'unspecified');
  assert.equal(card.orientation, undefined);
  await host('lobby', { ...hostValues, publicGender: 'woman' });
  [card] = (await peer('lobby', peerValues)).players;
  assert.equal(card.gender, 'woman');
  assert.deepEqual(card.limits, hostValues.limits);
  const incompatible = { ...peerValues, limits: { minMinutes: 19, maxMinutes: 20, maxIntensity: 3 } };
  assert.equal((await peer('lobby', incompatible)).players[0].compatible, false);
  assert.equal((await peer('invite', { ...incompatible, target: card.id })).status, 409);
  assert.equal((await host('lobby', { ...hostValues, limits: { minMinutes: 12, maxMinutes: 10, maxIntensity: 3 } })).status, 400);
  await peer('invite', { ...peerValues, target: card.id });
  const [invite] = (await host('lobby', hostValues)).incoming;
  assert.deepEqual(invite.limits, peerValues.limits);
  const settings = { ...hostValues, invite: invite.id, response: 'accept' };
  const { room } = await host('invite-response', settings);
  assert.deepEqual(room.limits, peerValues.limits);
  assert.equal(room.seconds, 12 * 60);
  assert.equal((await host('duration', { seconds: 11 * 60 })).status, 409);
  assert.equal((await peer('duration', { seconds: 16 * 60 })).status, 409);
  const updated = (await peer('duration', { seconds: 14 * 60 })).room;
  const ready = { ready: true, durationRevision: updated.durationRevision };
  await host('ready', ready);
  const { room: { game } } = await peer('ready', ready);
  now = game.startAt + 1000;
  const act = (client, kind, value, request) => client('interaction', { kind, value, round: game.id, request });
  assert.equal((await act(host, 'intensity', 3)).status, 409);
  assert.equal((await act(host, 'intensity', 2)).room.game.intensity, 2);
  assert.equal((await act(peer, 'intensity-adjust', 'lighter')).status, 403);
  assert.equal((await act(host, 'intensity-adjust', 'heavier')).room.game.intensity, 2);
  assert.equal((await act(host, 'intensity-adjust', 'lighter')).room.game.intensity, 1);
  assert.equal((await act(host, 'intensity-adjust', 'lighter')).room.game.intensity, undefined);
  assert.equal((await act(host, 'intensity-adjust', 'lighter')).room.game.intensity, undefined);

  const extension = (await act(host, 'extend', 60)).room.game.extension;
  assert.equal((await act(peer, 'extension-response', 'accept', extension.id)).room.game.seconds, 15 * 60);
  assert.equal((await act(host, 'extend', 30)).status, 409);
});

test('random partners require common durations and a standby player must accept the current round duration', async t => {
  let now = 100_000;
  t.mock.method(Date, 'now', () => now);
  const visitor = clients(memoryStore());
  const [host, peer, standby] = ['d', 'e', 'f'].map(key => visitor(key.repeat(64)));
  const control = { profile: { role: 'controller' }, limits: { minMinutes: 6, maxMinutes: 15, maxIntensity: 4 }, nickname: '等候补' };
  const incompatible = { profile: { role: 'receiver' }, limits: { minMinutes: 16, maxMinutes: 20, maxIntensity: 2 } };
  await host('match', control);
  assert.equal((await peer('match', incompatible)).state, 'queued');
  await peer('leave');
  const receiver = { ...incompatible, limits: { minMinutes: 8, maxMinutes: 10, maxIntensity: 3 } };
  const { room } = await peer('match', receiver);
  assert.equal(room.seconds, 10 * 60);
  await host('standby-open', { open: true });
  const short = { ...receiver, limits: { minMinutes: 6, maxMinutes: 8, maxIntensity: 0 } };
  const [listing] = (await standby('lobby', short)).standby;
  await standby('standby-join', { ...short, target: listing.id });
  await host('ready', { ready: true });
  const { room: { game } } = await peer('ready', { ready: true });
  now = game.startAt + 5000;
  await peer('leave');
  assert.equal((await standby('sync')).state, 'idle');
  assert.equal((await host('sync')).room.standby.vacant, true);
  assert.equal((await standby('standby-join', { ...short, target: listing.id })).status, 409);
  const compatible = { ...receiver, limits: { minMinutes: 10, maxMinutes: 12, maxIntensity: 0 } };
  const { room: promoted } = await standby('standby-join', { ...compatible, target: listing.id });
  assert.equal(promoted.code, room.code);
  assert.equal(promoted.game.id, game.id);
  assert.equal(promoted.limits.maxIntensity, 0);
});

test('random rooms are 10 minutes by default and both players confirm duration changes', async () => {
  const visitor = clients(memoryStore());
  const host = visitor();
  const guest = visitor();
  await host('match');
  const { room: matched } = await guest('match');
  const { code } = matched;
  assert.equal(matched.seconds, 600);
  assert.equal(matched.durationRevision, 0);
  await host('ready', { code, ready: true, durationRevision: 0 });
  const { room: unchanged } = await guest('duration', { code, seconds: 600 });
  assert.equal(unchanged.players[0].ready, true);
  assert.equal(unchanged.durationRevision, 0);
  for (const seconds of [0, 61, 7201, 7260, '1800', null]) {
    assert.equal((await guest('duration', { code, seconds })).status, 400);
  }
  const { room: updated } = await guest('duration', { code, seconds: 7200 });
  assert.equal(updated.durationRevision, 1);
  assert.equal(updated.seconds, 7200);
  assert.equal(updated.players.every(player => !player.ready), true);
  assert.equal((await host('ready', { code, ready: true, durationRevision: 0 })).status, 409);
  await guest('ready', { code, ready: true, durationRevision: 1 });
  const { room: started } = await host('ready', { code, ready: true, durationRevision: 1, compact: true });
  assert.equal(started.game.seconds, 7200);
  assert.equal(started.game.phases, undefined);
  const { room: legacy } = await guest('sync', { code });
  assert.deepEqual(roundPhases(started.game), legacy.game.phases);
  assert.equal(legacy.game.phases.at(-1).end, 7_200_000);
  assert.equal((await guest('duration', { code, seconds: 1800 })).status, 409);
});

test('friend rooms accept custom minutes at creation and can change the next round length', async t => {
  let now = 200_000;
  t.mock.method(Date, 'now', () => now);
  const visitor = clients(memoryStore());
  const host = visitor();
  const guest = visitor();
  assert.equal((await host('create', { seconds: 7260 })).status, 400);
  const { room: created } = await host('create', { seconds: 17 * 60 });
  assert.equal(created.seconds, 1020);
  const { code } = created;
  await guest('join', { code });
  const { room: changed } = await host('duration', { code, seconds: 60 });
  assert.equal(changed.durationRevision, 1);
  await host('ready', { code, ready: true, durationRevision: 1 });
  const { room: { game } } = await guest('ready', { code, ready: true, durationRevision: 1 });
  for (const step of [20_000, 20_000, 22_500]) {
    now += step;
    await host('sync', { code });
    await guest('sync', { code });
  }
  assert.equal(getProgress(game, now).done, true);
  const { room: next } = await guest('duration', { code, seconds: 2700 });
  assert.equal(next.seconds, 2700);
  assert.equal(next.game.seconds, 60);
  await host('ready', { code, ready: true, durationRevision: next.durationRevision });
  const { room: replay } = await guest('ready', { code, ready: true, durationRevision: next.durationRevision });
  assert.equal(replay.game.seconds, 2700);
  assert.notEqual(replay.game.id, game.id);
});

test('timed stops, custom tempo and receiver feedback synchronize and respect player roles', async t => {
  let now = 300_000;
  t.mock.method(Date, 'now', () => now);
  const visitor = clients(memoryStore());
  const host = visitor(), guest = visitor();
  const { room: { code } } = await host('create', { profile: { role: 'controller' } });
  await guest('join', { code, profile: { role: 'receiver' } });
  await host('ready', { code, ready: true });
  const { room: { game } } = await guest('ready', { code, ready: true });
  const act = (player, kind, value, options = {}) => player('interaction', { code, round: game.id, kind, value, ...options });

  now = game.startAt + 500;
  assert.equal((await act(guest, 'tempo', 75)).status, 403);
  assert.equal((await act(host, 'tempo', 71)).status, 400);
  await act(host, 'tempo', 75);
  await act(host, 'focus', 'hands');
  await act(host, 'intensity', 4);
  await act(host, 'hint', 'breathe');
  let observed = (await guest('sync', { code })).room.game;
  assert.equal(getProgress(observed, now).phase.bpm, 75);
  assert.equal(observed.focus, 'hands');
  assert.equal(observed.intensity, 4);
  assert.equal(observed.hint.key, 'breathe');
  assert.equal((await act(guest, 'tempo-adjust', 'faster')).status, 403);
  assert.equal(getProgress((await act(host, 'tempo-adjust', 'slower')).room.game, now).phase.bpm, 55);
  assert.equal(getProgress((await act(host, 'tempo-adjust', 'faster')).room.game, now).phase.bpm, 75);
  assert.equal(getProgress((await act(host, 'tempo-adjust', 'hold')).room.game, now).phase.bpm, 75);
  await act(host, 'hint', 'check');
  assert.equal((await guest('sync', { code })).room.game.hint.key, 'check');

  observed = (await act(host, 'stop-for', 10)).room.game;
  const stop = getProgress(observed, now);
  assert.equal(stop.phase.kind, 'stop');
  assert.equal(stop.phase.until - stop.elapsed, 10_000);
  assert.equal((await act(host, 'tempo-adjust', 'faster')).status, 409);
  await guest('mark', { code, round: game.id, index: stop.index });
  now += 10_100;
  assert.equal(getProgress((await guest('sync', { code })).room.game, now).phase.bpm, 75);
  assert.equal((await act(host, 'reply', 'rest')).status, 403);
  await act(guest, 'limit', 5);
  await act(guest, 'reply', 'keep-action');
  assert.equal((await host('sync', { code })).room.game.reply.key, 'keep-action');
  await act(guest, 'reply', 'uncomfortable');
  observed = (await host('sync', { code })).room.game;
  assert.equal(observed.limit, 5);
  assert.equal(observed.reply.key, 'uncomfortable');
  assert.equal(observed.pausedAt, now);
  now += 1000;
  assert.equal((await act(host, 'reply', 'recovered')).status, 403);
  const stillPaused = (await act(guest, 'reply', 'recovered')).room.game;
  assert.equal(stillPaused.reply.key, 'recovered');
  assert.equal(stillPaused.pausedAt, now - 1000);
  assert.equal((await act(host, 'tempo', 40)).status, 409);
  const ended = (await act(guest, 'finish')).room.game;
  assert.equal(getProgress(ended, now).done, true);
});

test('time extension only takes effect when the receiver accepts the current request', async t => {
  let now = 400_000;
  t.mock.method(Date, 'now', () => now);
  const visitor = clients(memoryStore());
  const host = visitor(), guest = visitor();
  const { room: { code } } = await host('create', { seconds: 60 });
  await guest('join', { code });
  await host('ready', { code, ready: true });
  const { room: { game } } = await guest('ready', { code, ready: true });
  now = game.startAt + 1000;
  const act = (player, kind, value, request) => player('interaction', { code, round: game.id, kind, value, request });

  const first = (await act(host, 'extend', 30)).room.game;
  assert.equal(first.seconds, 60);
  assert.equal((await act(host, 'extension-response', 'accept', first.extension.id)).status, 403);
  const declined = (await act(guest, 'extension-response', 'decline', first.extension.id)).room.game;
  assert.equal(declined.seconds, 60);
  const second = (await act(host, 'extend', 60)).room.game;
  assert.equal((await act(guest, 'extension-response', 'accept', first.extension.id)).status, 409);
  const accepted = (await act(guest, 'extension-response', 'accept', second.extension.id)).room.game;
  assert.equal(accepted.seconds, 120);
  assert.equal(accepted.extension, undefined);
  assert.equal(accepted.phases.at(-1).end, 120_000);
  assert.equal((await host('sync', { code })).room.game.seconds, 120);
});
