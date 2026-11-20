import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RoomVoice } from '../public/voice.js';

const audio = () => ({ pause() {}, srcObject: {}, muted: false });

test('WebRTC retries actual connection failure even if ICE connected', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const voice = new RoomVoice(audio(), async () => {}, () => {});
  voice.room = { me: 0 };
  voice.connection = { connectionState: 'failed', iceConnectionState: 'connected', close() {} };
  const retry = t.mock.method(voice, 'retry', async () => {});
  voice.scheduleRetry(10);
  t.mock.timers.tick(10);
  assert.equal(retry.mock.callCount(), 1);
  voice.destroy();
});

test('a failed call switches to compatibility mode only when the transport is ready', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const rtcClosed = t.mock.fn();
  const relay = { sync: t.mock.fn(), activate: t.mock.fn(async () => {}), setMuted: t.mock.fn(), destroy: t.mock.fn() };
  const voice = new RoomVoice(audio(), async () => {}, () => {}, { relay });
  voice.muted = true;
  voice.connection = { connectionState: 'failed', iceConnectionState: 'connected', close: rtcClosed };
  const room = { me: 1, players: [{ mic: true }, { mic: false }], voice: { id: 'session', status: 'approved' } };
  voice.accept(room, []);
  t.mock.timers.tick(10_000);
  assert.equal(relay.activate.mock.callCount(), 1);
  assert.equal(rtcClosed.mock.callCount(), 0);
  voice.accept({ ...room, voice: { ...room.voice, relay: { enabled: true, keys: ['first', null] } } }, []);
  assert.equal(rtcClosed.mock.callCount(), 0);
  voice.accept({ ...room, voice: { ...room.voice, relay: { enabled: true, keys: ['first', 'second'] } } }, []);
  assert.equal(rtcClosed.mock.callCount(), 0);
  relay.connected = true;
  voice.accept({ ...room, voice: { ...room.voice, relay: { enabled: true, keys: ['first', 'second'] } } }, []);
  assert.equal(voice.relayActive, true);
  assert.deepEqual(relay.setMuted.mock.calls.at(-1).arguments, [true]);
  assert.equal(rtcClosed.mock.callCount(), 1);
  voice.destroy();
  assert.equal(relay.destroy.mock.callCount(), 1);
});

test('an online event brings forward a pending microphone call retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const voice = new RoomVoice(audio(), async () => {}, () => {});
  voice.room = { me: 0, players: [{ mic: true }, { mic: false }] };
  voice.connection = { connectionState: 'disconnected', close() {} };
  const retry = t.mock.method(voice, 'retry', async () => {});
  voice.scheduleRetry(3500);
  voice.resumeNetwork();
  t.mock.timers.tick(100);
  assert.equal(retry.mock.callCount(), 1);
  voice.destroy();
});

test('speech bitrate drops on sustained loss and returns after sustained recovery', async () => {
  const voice = new RoomVoice(audio(), async () => {}, () => {});
  voice.connection = { connectionState: 'connected', close() {} };
  const encodings = [{}];
  const changes = [];
  let stats = { type: 'remote-inbound-rtp', fractionLost: 0.12, roundTripTime: 0.52 };
  const sender = {
    track: { kind: 'audio' },
    getStats: async () => new Map([['remote-audio', stats]]),
    getParameters: () => ({ encodings }),
    async setParameters(parameters) { changes.push(parameters.encodings[0].maxBitrate); }
  };
  voice.sender = sender;
  await voice.tuneSpeech(sender);
  await voice.tuneSpeech(sender);
  assert.deepEqual(changes, [32000, 16000]);
  stats = { ...stats, fractionLost: 0, roundTripTime: 0.1 };
  await voice.tuneSpeech(sender);
  await voice.tuneSpeech(sender);
  assert.deepEqual(changes, [32000, 16000]);
  await voice.tuneSpeech(sender);
  assert.deepEqual(changes, [32000, 16000, 32000]);
  voice.destroy();
});
