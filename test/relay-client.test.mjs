import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { adaptivePlaybackLead, RelayVoice } from '../public/relay.js';

test('relay buffering grows after a delayed batch and shrinks gradually on recovery', () => {
  assert.equal(adaptivePlaybackLead(.26, .4, 2), .26);
  const delayed = adaptivePlaybackLead(.26, .81, 2);
  assert.ok(delayed > .6 && delayed < .72);
  assert.equal(adaptivePlaybackLead(delayed, 2.5, 1), .72);
  const recovering = adaptivePlaybackLead(delayed, .2, 1);
  assert.ok(recovering < delayed && recovering > .6);
});

async function until(condition) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await delay(15);
  }
  assert.fail('relay client did not reach the expected state');
}

for (const watchSeat of [undefined, 0]) {
test(watchSeat === undefined ? 'room relay encrypts and plays a microphone frame' : 'spectator relay encrypts and plays a microphone frame', async t => {
  const contexts = [];
  const originalContext = globalThis.AudioContext;
  const originalStream = globalThis.MediaStream;
  const track = { readyState: 'live' };
  globalThis.MediaStream = class { constructor(tracks) { this.tracks = tracks; } };
  globalThis.AudioContext = class {
    constructor() {
      this.state = 'running';
      this.sampleRate = 48000;
      this.currentTime = 1;
      this.samples = [];
      this.starts = [];
      contexts.push(this);
    }

    createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
    createScriptProcessor() { return { connect() {}, disconnect() {} }; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createBuffer(channels, length, rate) {
      const data = new Float32Array(length);
      this.samples.push(data);
      return { getChannelData: () => data, duration: length / rate };
    }

    createBufferSource() { return { connect() {}, disconnect() {}, start: time => this.starts.push(time), stop() {} }; }
    async close() { this.state = 'closed'; }
  };
  const roomId = 'ABCD';
  const voiceId = 'test-voice';
  const frames = [];
  let releaseFirst;
  const stalled = new Promise(resolve => { releaseFirst = resolve; });
  const batches = [];
  const keys = [null, null];
  const peers = [0, 1].map(seat => new RelayVoice({ id: `player-${seat}`, guestKey: `key-${seat}`, code: roomId, voiceId, watchSeat,
    onChange() {}, async send(action, values) {
      assert.equal(action, 'relay-key');
      assert.equal(Buffer.from(values.publicKey, 'base64').length, 65);
      keys[seat] = values.publicKey;
      updateSnapshots();
    }
  }));
  const snapshots = seat => ({ me: seat, players: [{ mic: true }, { mic: false }],
    voice: { id: voiceId, status: 'approved', relay: { enabled: true, keys: [...keys] } } });
  const updateSnapshots = () => peers.forEach((peer, seat) => peer.sync(snapshots(seat)));
  t.after(() => {
    peers.forEach(peer => peer.destroy());
    globalThis.AudioContext = originalContext;
    globalThis.MediaStream = originalStream;
  });
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    assert.equal(path, '/api/relay');
    assert.equal(options.method, 'POST');
    const input = JSON.parse(options.body);
    assert.equal(input.code, roomId);
    assert.equal(input.voiceId, voiceId);
    assert.equal(input.watchSeat, watchSeat);
    if (input.action === 'push') {
      assert.equal(input.id, 'player-0');
      const packets = input.packets ?? [input.packet];
      batches.push(packets.length);
      for (const packet of packets) frames.push({ seq: frames.length + 1, packet });
      if (batches.length === 1) await stalled;
      return Response.json({ seq: frames.length });
    }
    return Response.json({ packets: input.id === 'player-1' ? frames.filter(frame => frame.seq > input.after) : [] });
  });

  await Promise.all(peers.map(peer => peer.unlock()));
  peers[0].setTrack(track);
  updateSnapshots();
  // The room would deliver the peer's key in subsequent snapshots.
  const refresh = setInterval(updateSnapshots, 20);
  t.after(() => clearInterval(refresh));
  await until(() => peers[1].connected && peers[0].capture?.processor);
  const positiveSample = new Float32Array(9600).fill(.25);
  const callback = peers[0].capture.processor.onaudioprocess;
  callback({ inputBuffer: { getChannelData: () => positiveSample } });
  await until(() => batches.length === 1);
  callback({ inputBuffer: { getChannelData: () => positiveSample } });
  callback({ inputBuffer: { getChannelData: () => positiveSample } });
  releaseFirst();
  await until(() => contexts[1].samples.length === 3);
  assert.equal(frames.length, 3);
  assert.deepEqual(batches, [1, 2]);
  for (const spacing of contexts[1].starts.slice(1).map((start, index) => start - contexts[1].starts[index])) {
    assert.ok(Math.abs(spacing - .2) < .001);
  }
  assert.equal(Buffer.from(frames[0].packet, 'base64').length, 1628);
  assert.equal(contexts[0].samples.length, 0);
  assert.ok(Math.abs(contexts[1].samples[0][0] - .25) < .02);

  peers[0].sync({ ...snapshots(0), voice: null });
  callback({ inputBuffer: { getChannelData: () => positiveSample } });
  assert.equal(peers[0].closed, true);
  assert.equal(contexts[0].state, 'closed');
  assert.equal(frames.length, 3);
});
}
