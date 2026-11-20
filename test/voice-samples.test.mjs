import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { api, guestAccount, memoryStore } from '../server/game.mjs';
import { databaseVoiceSamples } from '../server/voice-samples.mjs';

function wav(sampleCount) {
  const audio = Buffer.alloc(44 + sampleCount * 2);
  audio.write('RIFF');
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24);
  audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(audio.length - 44, 40);
  return audio;
}

test('published samples appear on the player card, enforce duration, and can be removed by their owner', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(await readFile(new URL('../drizzle/0010_voice_samples.sql', import.meta.url), 'utf8'));
  const samples = databaseVoiceSamples({
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...args) {
          const params = args.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value);
          return {
            run: () => statement.run(...params),
            first: () => statement.get(...params),
            all: () => ({ results: statement.all(...params) })
          };
        }
      };
    }
  });
  const store = memoryStore();
  const origin = 'https://jianke.test';
  const request = (path, options) => api(new Request(origin + path, options), store, {}, undefined, undefined, undefined, undefined, samples);
  const owner = 'a'.repeat(64);
  const listener = 'b'.repeat(64);
  const account = await guestAccount(owner);
  const publicPath = '/api/voice-sample/' + account;
  const ownerId = crypto.randomUUID();
  const listenerId = crypto.randomUUID();
  const lobby = (guestKey, id) => request('/api/room', {
    method: 'POST', body: JSON.stringify({ guestKey, id, action: 'lobby', adult: true, visible: true, voicePreviewList: true })
  }).then(response => response.json());
  const edit = (guestKey, method, body, from = origin) => request('/api/voice-sample', {
    method, body, headers: { Origin: from, 'Content-Type': 'audio/wav', 'X-Jianke-Guest-Key': guestKey }
  });

  await lobby(owner, ownerId);
  assert.equal((await lobby(listener, listenerId)).players[0].voiceSample, undefined);
  assert.equal((await request(publicPath)).status, 404);
  assert.equal((await edit(owner, 'POST', wav(80_001))).status, 413);
  assert.equal((await edit(owner, 'POST', Buffer.alloc(50))).status, 400);
  assert.equal((await edit(owner, 'POST', wav(1600), 'https://other.test')).status, 403);
  assert.equal((await edit(owner, 'POST', wav(80_000))).status, 200);
  assert.equal((await lobby(listener, listenerId)).players[0].voiceSample, true);
  const played = await request(publicPath);
  assert.equal(played.headers.get('Content-Type'), 'audio/wav');
  assert.deepEqual(Buffer.from(await played.arrayBuffer()), wav(80_000));
  const partial = await request(publicPath, { headers: { Range: 'bytes=0-1' } });
  assert.equal(partial.status, 206);
  assert.equal(await partial.text(), 'RI');
  await edit(listener, 'DELETE');
  assert.equal((await request(publicPath)).status, 200);
  assert.equal((await edit(owner, 'POST', wav(1600))).status, 200);
  assert.deepEqual(Buffer.from(await (await request(publicPath)).arrayBuffer()), wav(1600));
  await edit(owner, 'DELETE');
  assert.equal((await request(publicPath)).status, 404);
  assert.equal((await lobby(listener, listenerId)).players[0].voiceSample, undefined);
});
