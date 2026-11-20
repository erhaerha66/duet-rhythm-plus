import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { api, databaseStore, memoryStore } from '../server/game.mjs';

const settings = { ADMIN_EMAILS: 'operator@example.test', TURN_URL: 'turns:relay.example.test:443', TURN_USERNAME: 'test', TURN_CREDENTIAL: 'test-secret' };
const adminHeaders = { 'oai-authenticated-user-id': 'platform-fixture', 'oai-authenticated-user-email': 'operator@example.test' };

function client(store, name, admin = false, homepage = false) {
  const id = crypto.randomUUID();
  const guestKey = id.replaceAll('-', '').repeat(2);
  const headers = admin ? adminHeaders : {};
  const path = admin && !homepage ? '/api/admin/watch' : '/api/room';
  return { id, async send(action, values = {}) {
    const response = await api(new Request(`https://jianke.test${path}`, { method: 'POST', headers,
      body: JSON.stringify({ id, guestKey, nickname: name, adult: true, action, ...values }) }), store, settings);
    return { status: response.status, ...await response.json() };
  } };
}

async function inspect(store, headers) {
  const response = await api(new Request('https://jianke.test/api/admin', { headers }), store, settings);
  return { status: response.status, ...await response.json() };
}

async function room(store) {
  const host = client(store, '甲');
  const peer = client(store, '乙');
  const { room: { code } } = await host.send('create');
  await peer.send('join', { code });
  return { host, peer, code };
}

async function approveVoice(host, peer) {
  const { room: { voice } } = await host.send('voice-request');
  return (await peer.send('voice-response', { voiceId: voice.id, response: 'accept' })).room.voice;
}

test('both players can send chat, and spectators only receive messages sent to the open public chat', async t => {
  const now = 300_000;
  t.mock.method(Date, 'now', () => now);
  const store = memoryStore();
  const { host, peer, code } = await room(store);
  const viewer = client(store, '观众');
  const waiting = client(store, '候补');
  const privateMessage = { code, partnerRevision: 0, messageId: crypto.randomUUID(), message: '仅房内双方' };
  assert.equal((await host.send('room-chat', { ...privateMessage, public: true })).room.chat[0].public, false);
  for (const player of [host, peer]) await player.send('watch-open', { code, open: true });
  const [{ key }] = (await viewer.send('lobby')).watchable;
  assert.deepEqual((await viewer.send('watch-join', { key })).room.chat, []);
  const publicMessage = { code, partnerRevision: 0, messageId: crypto.randomUUID(), message: '收到，先暂停。', public: true };
  const posted = await peer.send('room-chat', publicMessage);
  assert.deepEqual(posted.room.chat.map(({ message, seat }) => [message, seat]), [['仅房内双方', 0], ['收到，先暂停。', 1]]);
  assert.deepEqual((await peer.send('room-chat', publicMessage)).room.chat, posted.room.chat);
  assert.equal((await peer.send('room-chat', { ...publicMessage, messageId: crypto.randomUUID() })).status, 429);
  assert.equal((await viewer.send('room-chat', publicMessage)).status, 403);
  assert.equal((await host.send('room-chat', { ...publicMessage, partnerRevision: 1 })).status, 409);
  const chat = (await viewer.send('watch-sync', { key })).room.chat;
  assert.deepEqual(chat.map(entry => entry.message), ['收到，先暂停。']);
  await host.send('standby-open', { code, open: true });
  const [hostCard] = (await waiting.send('lobby')).standby;
  const queued = await waiting.send('standby-join', { target: hostCard.id });
  assert.deepEqual(queued.standby.chat.messages, chat);
  assert.equal(queued.standby.chat.controller, posted.room.controller);
  assert.deepEqual((await waiting.send('sync', { standbyCode: code })).standby.chat.messages, chat);
  assert.equal((await waiting.send('room-chat', { ...publicMessage, messageId: crypto.randomUUID() })).status, 403);

  assert.equal((await viewer.send('lobby')).watchable[0].chat, undefined);
  await peer.send('watch-open', { code, open: false });
  assert.equal((await viewer.send('watch-sync', { key })).state, 'watch-closed');
  assert.equal((await waiting.send('sync', { standbyCode: code })).standby.chat, undefined);
  await host.send('standby-open', { code, open: true });
  await peer.send('leave', { code });
  assert.equal((await host.send('sync', { code })).room.chat, undefined);
});

test('spectators see synchronized pace and receive permitted presets while shared media is disabled', async t => {
  let now = 300_000;
  t.mock.method(Date, 'now', () => now);
  const store = memoryStore();
  const { host, peer, code } = await room(store);
  const viewer = client(store, '观众');
  await host.send('ready', { ready: true, watchOpen: true, shareDetails: true });
  const { room: { game } } = await peer.send('ready', { ready: true, watchOpen: true });
  now = game.startAt + 500;
  const [card] = (await viewer.send('lobby')).watchable;
  const watch = { key: card.key };
  await viewer.send('watch-join', watch);
  const act = (player, kind, value) => player.send('interaction', { code, round: game.id, kind, value });
  assert.equal((await act(host, 'tempo', 75)).status, 200);
  assert.equal((await act(peer, 'reply', 'keep-action')).status, 200);
  const observe = async () => (await viewer.send('watch-sync', watch)).room;
  const first = await observe();
  assert.deepEqual(first.beat, { bpm: 75, origin: now });
  assert.equal(first.interaction.selectedTempo, 75);
  assert.equal(first.interaction.reply, undefined);
  await peer.send('watch-open', { open: true, shareDetails: true });
  assert.equal((await observe()).interaction.reply, 'keep-action');
  assert.equal((await act(peer, 'custom-hint', '私人指令')).status, 403);
  assert.equal((await act(host, 'custom-hint', '长'.repeat(49))).status, 400);
  assert.equal((await act(host, 'hint', 'three-beats')).status, 200);
  assert.equal((await observe()).interaction.hint, 'three-beats');
  assert.equal((await act(host, 'custom-hint', '  先慢下来  ')).status, 200);
  assert.equal((await peer.send('sync', { code })).room.game.hint.text, '先慢下来');
  assert.ok(!JSON.stringify(await observe()).includes('先慢下来'));


  const source = { kind: 'video', url: 'https://example.test/demo.mp4' };
  for (const player of [host, peer]) assert.equal((await player.send('watch-media-allow', { open: true })).status, 403);
  assert.equal((await host.send('watch-media-share', { source })).status, 403);
  store.change(state => { state.rooms[code].watch.media = source; });
  assert.equal((await observe()).media, undefined);
  await act(peer, 'reply', 'uncomfortable');
  assert.equal((await observe()).beat, null);
});

test('spectating requires room opt-in and signaling requires both listening settings', async () => {
  const store = memoryStore();
  const { host, peer } = await room(store);
  const viewer = client(store, '观众');
  await host.send('watch-open', { open: true });
  assert.deepEqual((await viewer.send('lobby')).watchable, []);
  await peer.send('watch-open', { open: true });
  const [card] = (await viewer.send('lobby')).watchable;
  assert.equal(card.code, undefined);
  assert.equal((await viewer.send('watch-join', { key: card.key })).state, 'watching');
  assert.equal((await viewer.send('watch-listen', { key: card.key })).status, 403);
  const voice = await approveVoice(host, peer);
  assert.equal((await host.send('voice-config', { voiceId: voice.id })).iceServers[1].credential, settings.TURN_CREDENTIAL);
  const publicConfig = await api(new Request('https://jianke.test/api/config'), store, settings);
  assert.equal((await publicConfig.json()).iceServers.length, 1);
  await host.send('watch-audio-open', { open: true });
  assert.equal((await viewer.send('watch-listen', { key: card.key })).status, 403);
  await peer.send('watch-audio-open', { open: true });
  const { room: { request } } = await viewer.send('watch-sync', { key: card.key });
  const offer = { listener: viewer.id, request, data: { description: { type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendonly\r\n' } } };
  assert.equal((await viewer.send('watch-config', { key: card.key, request })).state, 'ice');
  await host.send('watch-send', offer);
  const listening = await viewer.send('watch-sync', { key: card.key });
  assert.equal(listening.room.listen, 'approved');
  assert.equal(listening.signals[0].seat, 0);
  assert.deepEqual((await peer.send('sync')).watchSignals, []);
  const answer = { description: { type: 'answer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=recvonly\r\n' } };
  await viewer.send('watch-receive', { key: card.key, request, seat: 0, data: answer });
  assert.deepEqual((await host.send('sync')).watchSignals[0].data, answer);
  await peer.send('watch-audio-open', { open: false });
  const revoked = await viewer.send('watch-sync', { key: card.key });
  assert.equal(revoked.room.listen, 'off');
  assert.deepEqual(revoked.signals, []);
  assert.equal((await host.send('watch-send', offer)).status, 403);
  await peer.send('watch-open', { open: false });
  assert.equal((await viewer.send('watch-sync', { key: card.key })).state, 'watch-closed');
});

test('admin inspection is metadata-only and has no listening endpoint or observer privilege', async () => {
  const store = memoryStore();
  const { host, peer, code } = await room(store);
  const admin = client(store, '后台', true);
  const adminHome = client(store, '首页后台', true, true);
  assert.equal((await inspect(store)).status, 403);
  assert.equal((await inspect(store, { ...adminHeaders, 'oai-authenticated-user-email': 'other@example.test' })).status, 403);
  assert.equal((await inspect(store, { 'oai-authenticated-user-email': 'operator@example.test' })).status, 403);
  const snapshot = await inspect(store, adminHeaders);
  assert.equal(snapshot.rooms[0].code, code);
  assert.equal(snapshot.people.length, 2);
  assert.equal(snapshot.rooms[0].seconds, 600);
  assert.equal(snapshot.rooms[0].voiceStatus, 'off');
  assert.equal(snapshot.rooms[0].microphones, 0);
  assert.equal(snapshot.rooms[0].relayEnabled, false);
  assert.deepEqual((await host.send('sync')).room.audience.viewers, []);
  const { room: { voice: { id: voiceId } } } = await host.send('voice-request');
  assert.equal((await inspect(store, adminHeaders)).rooms[0].voiceStatus, 'pending');
  await peer.send('voice-response', { voiceId, response: 'accept' });
  await host.send('mic', { voiceId, on: true });
  await host.send('relay-enable', { voiceId });
  await host.send('ready', { ready: true });
  await peer.send('ready', { ready: true });
  const [diagnostics] = (await inspect(store, adminHeaders)).rooms;
  assert.equal(diagnostics.voiceStatus, 'approved');
  assert.equal(diagnostics.microphones, 1);
  assert.equal(diagnostics.relayEnabled, true);
  assert.ok(diagnostics.remaining > 0);
  assert.ok(!Object.hasOwn(diagnostics, 'cue') && !Object.hasOwn(diagnostics, 'bpm') && !Object.hasOwn(diagnostics, 'voice'));
  assert.deepEqual((await host.send('sync')).room.audience.viewers, []);
  assert.equal((await admin.send('watch-join', { code })).status, 404);
  for (const player of [host, peer]) await player.send('watch-open', { open: true });
  for (const player of [host, peer]) await player.send('watch-audio-open', { open: true });
  assert.equal((await admin.send('watch-sync', { code })).status, 404);
  assert.equal((await adminHome.send('watch-join', { code })).state, 'watch-closed');
  const [{ key }] = (await adminHome.send('lobby')).watchable;
  assert.equal((await adminHome.send('watch-join', { key, adult: false })).status, 403);
  assert.deepEqual((await host.send('sync')).room.audience.viewers, []);
  const voice = (await host.send('sync')).room.voice;
  await host.send('voice-close', { voiceId: voice.id });
  assert.equal((await inspect(store, adminHeaders)).rooms[0].microphones, 0);
  assert.equal((await admin.send('watch-config', { code })).status, 404);
});

test('public audio admits present and new spectators without individual votes and stops on withdrawal', async () => {
  const store = memoryStore();
  const { host, peer } = await room(store);
  const first = client(store, '观众甲');
  const second = client(store, '观众乙');
  const enable = { open: true };
  const disable = { open: false };
  const { id: voiceId } = await approveVoice(host, peer);
  await host.send('watch-open', enable);
  await peer.send('watch-open', enable);
  const [card] = (await first.send('lobby')).watchable;
  const entry = { key: card.key };
  assert.equal(card.publicAudio, false);
  assert.equal((await first.send('watch-join', entry)).room.listen, 'off');

  await host.send('watch-audio-open', enable);
  assert.equal((await first.send('watch-sync', entry)).room.listen, 'off');
  const enabled = await peer.send('watch-audio-open', enable);
  assert.equal(enabled.room.audience.publicAudio, true);
  assert.equal(enabled.room.audience.viewers[0].publicAudio, true);
  assert.equal((await second.send('lobby')).watchable[0].publicAudio, true);
  const firstListen = (await first.send('watch-sync', entry)).room;
  const secondListen = (await second.send('watch-join', entry)).room;
  assert.equal(firstListen.listen, 'approved');
  assert.equal(secondListen.listen, 'approved');
  assert.equal(secondListen.publicAudio, true);
  assert.notEqual(firstListen.request, secondListen.request);
  assert.equal((await inspect(store, adminHeaders)).rooms[0].publicAudio, true);

  const offer = { listener: first.id, request: firstListen.request,
    data: { description: { type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendonly\r\n' } } };
  assert.equal((await host.send('watch-send', offer)).status, 200);
  assert.equal((await first.send('watch-sync', entry)).signals[0].request, firstListen.request);
  assert.equal((await second.send('watch-sync', entry)).signals.length, 0);
  assert.equal((await first.send('watch-config', { ...entry, request: firstListen.request })).state, 'ice');

  await peer.send('watch-audio-open', disable);
  const stopped = await first.send('watch-sync', entry);
  assert.equal(stopped.room.listen, 'off');
  assert.deepEqual(stopped.signals, []);
  assert.equal((await first.send('watch-config', { ...entry, request: firstListen.request })).status, 403);
  assert.equal((await second.send('watch-sync', entry)).room.listen, 'off');
  assert.equal((await host.send('watch-send', offer)).status, 403);
  assert.equal((await first.send('watch-listen', entry)).status, 403);

  await peer.send('watch-audio-open', enable);
  const restarted = (await first.send('watch-sync', entry)).room;
  assert.equal(restarted.listen, 'approved');
  assert.notEqual(restarted.request, firstListen.request);
  await host.send('voice-close', { voiceId });
  assert.equal((await first.send('watch-sync', entry)).room.listen, 'off');
  await approveVoice(host, peer);
  assert.equal((await host.send('sync')).room.audience.audioOptedIn, true);
  assert.equal((await first.send('watch-sync', entry)).room.listen, 'approved');

  await host.send('watch-audio-open', enable);
  await peer.send('watch-audio-open', enable);
  await host.send('watch-open', disable);
  assert.equal((await first.send('watch-sync', entry)).state, 'watch-closed');
  await host.send('watch-open', enable);
  const [reopened] = (await first.send('lobby')).watchable;
  assert.notEqual(reopened.key, entry.key);
  assert.equal(reopened.publicAudio, false);
});

test('public rooms admit twelve listeners with no admin exception and return the next free seat', async () => {
  const store = memoryStore();
  const { host, peer } = await room(store);
  const adminHome = client(store, '首页后台', true, true);
  for (const member of [host, peer]) await member.send('watch-open', { open: true });
  await approveVoice(host, peer);
  for (const member of [host, peer]) await member.send('watch-audio-open', { open: true });
  const viewers = Array.from({ length: 13 }, (_, index) => client(store, `观众${index + 1}`));
  const [card] = (await viewers[0].send('lobby')).watchable;
  assert.equal(card.viewerLimit, 12);
  const entry = { key: card.key };
  const admissions = await Promise.all(viewers.map(viewer => viewer.send('watch-join', entry)));
  const admitted = admissions.flatMap((admission, index) => admission.status === 200 ? [viewers[index]] : []);
  const rejected = admissions.findIndex(admission => admission.status === 409);
  assert.equal(admitted.length, 12);
  assert.ok(admissions.filter(admission => admission.status === 200).every(admission => admission.room.listen === 'approved'));
  assert.match(admissions[rejected].error, /旁观人数已满（12 人）/);
  const [full] = (await viewers[rejected].send('lobby')).watchable;
  assert.equal(full.viewers, full.viewerLimit);
  assert.equal((await admitted[0].send('watch-join', entry)).room.viewers, 12);
  assert.equal((await adminHome.send('watch-join', entry)).status, 409);
  const { room: { audience } } = await host.send('sync');
  assert.equal(audience.viewerCount, 12);
  assert.equal(audience.viewers.length, 12);
  const fullEntry = await api(new Request('https://jianke.test/api/active-rooms', { headers: adminHeaders }), store, settings);
  assert.equal(Object.hasOwn(await fullEntry.json(), 'canEnterFullRoom'), false);
  await admitted[0].send('watch-leave', entry);
  const filled = (await viewers[rejected].send('watch-join', entry)).room;
  assert.equal(filled.viewers, 12);
  assert.equal(filled.listen, 'approved');
});

test('database viewer admission and listening preserve concurrent room updates and isolation', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(await readFile(new URL('../drizzle/0000_lobby.sql', import.meta.url), 'utf8'));
  let changedDuringAdmission = 0;
  let changedDuringListening = 0;
  const store = databaseStore({
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bind = (...values) => ({
        first: async () => statement.get(...values),
        run: async () => {
          if (sql.includes("AS viewer") && values.length === 7) {
            const roomSequence = values[0] + '.sequence';
            sqlite.prepare('UPDATE lobby_state SET revision = revision + 1, payload = json_set(payload, ?, 42)').run(roomSequence);
            changedDuringAdmission += 1;
          }
          if (!changedDuringListening && sql.includes('SET revision = revision + ?4') && sql.includes("'.watch.viewers'") &&
            JSON.parse(values[2]).viewers.some(viewer => viewer.request && viewer.publicAudio)) {
            sqlite.prepare('UPDATE lobby_state SET payload = json_set(payload, ?, 73)').run(values[0] + '.sequence');
            changedDuringListening += 1;
          }
          return { meta: statement.run(...values) };
        }
      });
      return { ...bind(), bind };
    }
  });
  const first = await room(store);
  const second = await room(store);
  for (const player of [first.host, first.peer, second.host, second.peer]) await player.send('watch-open', { open: true });
  const viewer = client(store, '测试观众');
  const cards = (await viewer.send('lobby')).watchable;
  assert.equal(cards.length, 2);
  const results = await Promise.all(cards.map(({ key }) => viewer.send('watch-join', { key })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.ok(changedDuringAdmission >= 1);
  const state = JSON.parse(sqlite.prepare('SELECT payload FROM lobby_state').get().payload);
  assert.equal(Object.values(state.rooms).flatMap(room => room.watch.viewers).length, 1);
  const joined = results.findIndex(result => result.status === 200);
  const joinedRoom = [first, second].find(candidate => state.rooms[candidate.code].watch.key === cards[joined].key);
  assert.equal(state.rooms[joinedRoom.code].sequence, 42);
  await approveVoice(joinedRoom.host, joinedRoom.peer);
  const entry = { key: cards[joined].key };
  assert.equal((await viewer.send('watch-listen', entry)).status, 403);
  for (const member of [joinedRoom.host, joinedRoom.peer]) await member.send('watch-audio-open', { open: true });
  const later = Date.now() + 13_000;
  t.mock.method(Date, 'now', () => later);
  const { room: { request } } = await viewer.send('watch-sync', entry);
  assert.ok(request);
  assert.equal((await viewer.send('watch-config', { ...entry, request })).state, 'ice');
  const answer = { description: { type: 'answer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=recvonly\r\n' } };
  await viewer.send('watch-receive', { key: cards[joined].key, request, seat: 0, data: answer });
  assert.ok(changedDuringListening >= 1);
  const latest = JSON.parse(sqlite.prepare('SELECT payload FROM lobby_state').get().payload);
  assert.equal(latest.rooms[joinedRoom.code].sequence, 74);
  assert.deepEqual((await joinedRoom.host.send('sync')).watchSignals[0].data, answer);
  assert.equal((await viewer.send('watch-leave', { key: cards[joined].key })).state, 'watch-closed');
  assert.equal((await viewer.send('watch-join', { key: cards[1 - joined].key })).state, 'watching');
});

test('the homepage lists only active, visible rounds with public gender labels and without private player details', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const store = memoryStore();
  const host = client(store, '甲');
  const peer = client(store, '乙');
  const { room: { code } } = await host.send('create', { publicGender: 'woman', profile: { gender: 'woman', role: 'receiver' } });
  await peer.send('join', { code, profile: { gender: 'man', role: 'controller' } });
  const viewer = client(store, '观众');
  const directory = async () => {
    const result = await api(new Request('https://jianke.test/api/active-rooms'), store, settings);
    assert.equal(result.status, 200);
    return (await result.json()).rooms;
  };
  const ready = { ready: true, watchOpen: true };
  assert.equal((await host.send('sync')).room.audience.preferOpen, true);
  await host.send('ready', ready);
  assert.deepEqual(await directory(), []);
  const { room: { game } } = await peer.send('ready', ready);
  const [listed] = await directory();
  const entry = { key: listed.key };
  assert.deepEqual(listed, { ...entry, status: 'countdown', viewers: 0, viewerLimit: 12, publicAudio: false,
    roleGenders: { controller: 'unspecified', receiver: 'woman' } });
  assert.equal((await viewer.send('watch-join', entry)).room.listen, 'off');
  assert.equal((await directory())[0].viewers, 1);
  now = game.startAt + 1000;
  assert.equal((await directory())[0].status, 'playing');
  await host.send('pause');
  assert.equal((await directory())[0].status, 'paused');
  await host.send('watch-open', { open: false });
  assert.deepEqual(await directory(), []);
  assert.equal((await viewer.send('watch-sync', entry)).state, 'watch-closed');
  assert.equal((await host.send('sync')).room.audience.preferOpen, false);
  await host.send('ready', { ready: true, watchOpen: false });
  await peer.send('ready', ready);
  assert.deepEqual(await directory(), []);

  const reopened = await host.send('watch-open', { open: true });
  const [again] = await directory();
  assert.notEqual(again.key, entry.key);
  assert.equal(again.publicAudio, false);
  await approveVoice(host, peer);
  await host.send('watch-audio-open', { open: true });
  assert.equal((await directory())[0].publicAudio, false);
  await peer.send('watch-audio-open', { open: true });
  assert.equal((await directory())[0].publicAudio, true);
  now = reopened.room.game.resumeAt + 10;
  await host.send('interaction', { round: game.id, kind: 'finish' });
  assert.deepEqual(await directory(), []);
});
