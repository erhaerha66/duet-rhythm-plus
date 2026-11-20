import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { api, databaseStore, memoryStore } from '../server/game.mjs';

async function publicKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64');
}

function player(store) {
  const id = crypto.randomUUID();
  const guestKey = crypto.randomUUID().replaceAll('-', '').repeat(2);
  const send = async (path, action, values) => {
    const response = await api(new Request(`https://jianke.test/api/${path}`, {
      method: 'POST', body: JSON.stringify({ id, guestKey, adult: true, action, ...values })
    }), store, {});
    return { status: response.status, ...await response.json() };
  };
  return { id, room: send.bind(null, 'room'), relay: send.bind(null, 'relay') };
}

async function relayDatabase(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  for (const migration of ['0000_lobby.sql', '0002_voice_relay.sql']) {
    sqlite.exec(await readFile(new URL(`../drizzle/${migration}`, import.meta.url), 'utf8'));
  }
  const store = databaseStore({
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const changes = sqlite.prepare('SELECT total_changes() AS count');
      const bind = (...values) => ({
        first: async () => statement.get(...values),
        all: async () => ({ results: statement.all(...values) }),
        run: async () => {
          const before = changes.get().count;
          statement.run(...values);
          return { meta: { changes: changes.get().count - before } };
        }
      });
      return { ...bind(), bind };
    }
  });
  return { store, count: () => sqlite.prepare('SELECT COUNT(*) AS count FROM voice_relay_packets').get().count };
}

for (const backend of ['memory', 'D1']) {
  test(`${backend} spectator backup requires permission and isolates each listener and speaker`, async t => {
    const { store } = backend === 'D1' ? await relayDatabase(t) : { store: memoryStore() };
    const a = player(store);
    const b = player(store);
    const viewer = player(store);
    const outsider = player(store);
    const { room: { code } } = await a.room('create');
    await b.room('join', { code });
    for (const member of [a, b]) await member.room('watch-open', { code, open: true });
    const [{ key }] = (await viewer.room('lobby')).watchable;
    const { room: { voice } } = await a.room('voice-request', { code });
    await b.room('voice-response', { code, voiceId: voice.id, response: 'accept' });
    for (const member of [a, b]) await member.room('watch-audio-open', { code, open: true });
    const { room: { request } } = await viewer.room('watch-join', { key });
    const context = { watchRequest: request, watchSeat: 0 };
    const packet = Buffer.alloc(50, 27).toString('base64');
    assert.equal((await viewer.relay('pull', context)).status, 403);
    assert.equal((await viewer.room('watch-receive', { key, request, seat: 0, data: { relayKey: await publicKey() } })).status, 200);
    assert.equal((await a.room('watch-send', { code, listener: viewer.id, request, data: { relayKey: await publicKey() } })).status, 200);
    assert.equal((await a.relay('push', { ...context, packet })).status, 403);
    await a.room('mic', { code, voiceId: voice.id, on: true });
    assert.equal((await b.relay('push', { ...context, packet })).status, 403);
    const { seq } = await a.relay('push', { ...context, packet });
    assert.ok(Number.isSafeInteger(seq));
    assert.equal((await outsider.relay('pull', { ...context, id: viewer.id })).status, 403);
    assert.deepEqual((await viewer.relay('pull', context)).packets, [{ seq, packet }]);
    assert.equal((await viewer.relay('pull', { ...context, watchSeat: 1 })).status, 403);
    await a.room('mic', { code, voiceId: voice.id, on: false });
    assert.deepEqual((await viewer.relay('pull', context)).packets, []);
    await b.room('watch-audio-open', { code, open: false });
    assert.equal((await viewer.relay('pull', context)).status, 403);
    assert.equal((await a.relay('push', { ...context, packet })).status, 403);
  });

  test(`${backend} relay isolates voice packets and stops delivery on mute, expiry, or revoked consent`, async t => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const { store, count } = backend === 'D1' ? await relayDatabase(t) : { store: memoryStore() };
    const a = player(store);
    const b = player(store);
    const outsider = player(store);
    const { room: { code } } = await a.room('create');
    await b.room('join', { code });
    const pa = await publicKey();
    const pb = await publicKey();
    const { room: { voice } } = await a.room('voice-request', { code });
    const context = { code, voiceId: voice.id };
    const packet = Buffer.alloc(50, 27).toString('base64');
    assert.equal((await a.room('relay-enable', context)).status, 403);
    assert.equal((await a.room('relay-key', { ...context, publicKey: pa })).status, 403);
    await b.room('voice-response', { ...context, response: 'accept' });
    assert.equal((await a.room('relay-key', { ...context, publicKey: Buffer.alloc(65).toString('base64') })).status, 400);
    await a.room('relay-key', { ...context, publicKey: pa });
    assert.equal((await a.room('relay-key', { ...context, publicKey: pb })).status, 409);
    assert.deepEqual((await a.room('relay-enable', context)).room.voice.relay, { enabled: true, keys: [pa, null] });
    assert.equal((await b.relay('pull', context)).status, 403);
    assert.deepEqual((await b.room('relay-key', { ...context, publicKey: pb })).room.voice.relay.keys, [pa, pb]);
    assert.deepEqual((await b.room('relay-key', { ...context, publicKey: pb })).room.voice.relay.keys, [pa, pb]);
    assert.equal((await a.relay('push', { ...context, packet })).status, 403);
    await a.room('mic', { ...context, on: true });
    const { seq } = await a.relay('push', { ...context, packet });
    assert.ok(Number.isSafeInteger(seq));
    assert.equal((await a.relay('push', { ...context, packet })).status, 429);
    assert.equal((await outsider.relay('pull', { ...context, id: b.id })).status, 403);
    assert.equal((await outsider.relay('push', { ...context, id: a.id, packet })).status, 403);
    assert.deepEqual((await a.relay('pull', context)).packets, []);
    assert.deepEqual((await b.relay('pull', context)).packets, [{ seq, packet }]);
    assert.deepEqual((await b.relay('pull', { ...context, after: seq })).packets, []);
    now += 150;
    const batch = [Buffer.alloc(50, 11).toString('base64'), Buffer.alloc(50, 32).toString('base64')];
    assert.equal((await a.relay('push', { ...context, packets: Array(5).fill(packet) })).status, 400);
    const pushedBatch = await a.relay('push', { ...context, packets: batch });
    assert.equal(pushedBatch.status, 200);
    const receivedBatch = (await b.relay('pull', { ...context, after: seq })).packets;
    assert.deepEqual(receivedBatch.map(row => row.packet), batch);
    assert.equal(receivedBatch.at(-1).seq, pushedBatch.seq);
    await a.room('mic', { ...context, on: false });
    assert.deepEqual((await b.relay('pull', context)).packets, []);
    now += 150;
    await a.room('mic', { ...context, on: true });
    assert.deepEqual((await b.relay('pull', context)).packets, []);
    assert.equal((await a.relay('push', { ...context, packet })).status, 200);
    now += 4001;
    assert.deepEqual((await b.relay('pull', context)).packets, []);
    const next = await a.relay('push', { ...context, packet });
    assert.equal(next.status, 200);
    if (count) assert.equal(count(), 1);
    const closed = await b.room('voice-close', context);
    assert.equal(closed.status, 200);
    assert.equal(closed.room.voice, null);
    if (count) assert.equal(count(), 0);
    assert.equal((await a.relay('push', { ...context, packet })).status, 403);
    assert.equal((await b.relay('pull', context)).status, 403);
  });
}
