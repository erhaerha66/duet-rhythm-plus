const sampleRateHz = 8000;
const frameSamples = 1600;
const nonceSize = 12;
const voicePacketSize = nonceSize + frameSamples + 16;
const captureBacklog = 4;
const playbackLead = .26;
const frameDuration = frameSamples / sampleRateHz;
const maxPlaybackLead = .72;

export function adaptivePlaybackLead(previous, delay, frameCount) {
  const observed = Math.max(playbackLead, Math.min(maxPlaybackLead, delay - frameCount * frameDuration + playbackLead));
  return observed >= previous ? observed : previous * .94 + observed * .06;
}

function encodeSample(sample) {
  const magnitude = Math.min(32635, Math.abs(Math.round(sample * 32768))) + 132;
  const exponent = Math.floor(Math.log2(magnitude)) - 7;
  const mantissa = (magnitude >> (exponent + 3)) & 15;
  return ~(sample < 0 ? 128 | (exponent << 4) | mantissa : (exponent << 4) | mantissa) & 255;
}

function decodeSample(byte) {
  const value = ~byte & 255;
  const magnitude = ((((value & 15) << 3) + 132) << ((value >> 4) & 7)) - 132;
  return (value & 128 ? -magnitude : magnitude) / 32768;
}

class CaptureFrames {
  constructor(sourceRate, onFrame) {
    this.sourceRate = sourceRate;
    this.onFrame = onFrame;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.index = 0;
    this.frame = new Uint8Array(frameSamples);
  }

  write(input) {
    for (let i = 0; i < input.length; i += 1) {
      this.sum += input[i];
      this.count += 1;
      this.phase += sampleRateHz;
      if (this.phase < this.sourceRate) continue;
      this.phase -= this.sourceRate;
      this.frame[this.index] = encodeSample(this.sum / this.count);
      this.sum = 0;
      this.count = 0;
      this.index += 1;
      if (this.index === frameSamples) {
        this.onFrame(this.frame);
        this.frame = new Uint8Array(frameSamples);
        this.index = 0;
      }
    }
  }
}

// The same module is loaded in the audio worklet. It outputs silence locally.
if (typeof registerProcessor === 'function') {
  class RelayCapture extends AudioWorkletProcessor {
    constructor() {
      super();
      this.frames = new CaptureFrames(sampleRate, frame => this.port.postMessage(frame, [frame.buffer]));
    }

    process(inputs) {
      const channel = inputs[0]?.[0];
      if (channel) this.frames.write(channel);
      return true;
    }
  }
  registerProcessor('jianke-relay-capture', RelayCapture);
}

const base64 = bytes => btoa(String.fromCharCode(...bytes));
const binary = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
const captureWorklets = new WeakMap();

export class RelayVoice {
  constructor({ id, guestKey, code, voiceId, send, onChange, watchSeat, sharedContext }) {
    this.credentials = { id, guestKey, code, voiceId, ...(watchSeat === undefined ? {} : { watchRequest: voiceId, watchSeat }) };
    this.watchSeat = watchSeat;
    this.sharedContext = sharedContext;
    this.send = send;
    this.onChange = onChange;
    this.closed = false;
    this.enabled = false;
    this.connected = false;
    this.audioBlocked = false;
    this.muted = false;
    this.after = 0;
    this.failures = 0;
    this.nextPlayback = 0;
    this.pendingFrames = [];
    this.playing = new Set();
    this.status = '正在准备备用语音连接…';
  }

  update(status, connected = this.connected) {
    if (this.closed || (this.status === status && this.connected === connected)) return;
    this.status = status;
    this.connected = connected;
    this.onChange();
  }

  contextForAudio() {
    if (this.context) return this.context;
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Context) throw new Error('此浏览器不支持备用语音。');
    const shared = this.sharedContext?.();
    this.context = shared ?? new Context({ latencyHint: 'interactive' });
    this.ownsContext = !shared;
    this.output = this.context.createGain();
    this.output.gain.value = this.muted ? 0 : 1;
    this.output.connect(this.context.destination);
    this.onContextChange = () => this.updateAudioState();
    this.context.addEventListener?.('statechange', this.onContextChange);
    return this.context;
  }

  updateAudioState() {
    if (this.closed) return;
    const blocked = this.enabled && this.context?.state !== 'running' && !this.muted;
    if (this.audioBlocked === blocked) return;
    this.audioBlocked = blocked;
    if (blocked) this.clearPlayback();
    this.onChange();
  }

  async unlock() {
    if (this.closed) return;
    const context = this.contextForAudio();
    this.updateAudioState();
    if (context.state !== 'running') await context.resume();
    this.updateAudioState();
  }

  activate() {
    if (this.closed) return Promise.resolve();
    // A background fallback may resume only after a later browser gesture.
    this.unlock().catch(() => this.updateAudioState());
    if (this.enabled) return Promise.resolve();
    if (this.enabling) return this.enabling;
    this.update('正在切换到备用语音连接…');
    this.enabling = Promise.resolve().then(() => this.send('relay-enable', { voiceId: this.credentials.voiceId }))
      .catch(error => {
        this.update(error.message || '暂时无法开启备用语音。', false);
        throw error;
      }).finally(() => { this.enabling = undefined; });
    return this.enabling;
  }

  sync(room) {
    if (this.closed || !room) return;
    if (room.voice?.id !== this.credentials.voiceId || room.voice.status !== 'approved' || room.players.length !== 2) {
      this.destroy();
      return;
    }
    this.room = room;
    const enabled = room.voice.relay?.enabled === true;
    if (!enabled) return;
    if (!this.enabled) {
      this.enabled = true;
      this.update('正在建立加密备用语音…', false);
      if (this.watchSeat === undefined || room.me === 1) this.unlock().catch(() => this.updateAudioState());
    }
    this.prepareKeys();
  }

  prepareKeys() {
    if (this.closed || this.preparing || this.key || this.keyRetry) return;
    this.preparing = true;
    this.establishKey().catch(() => {
      if (this.closed) return;
      this.update('备用语音连接暂未就绪，正在重试…', false);
      this.keyRetry = setTimeout(() => {
        this.keyRetry = undefined;
        this.prepareKeys();
      }, 1600);
    }).finally(() => { this.preparing = false; });
  }

  async establishKey() {
    const subtle = crypto.subtle;
    if (!this.keyPair) {
      this.keyPair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
      this.publicKey = base64(new Uint8Array(await subtle.exportKey('raw', this.keyPair.publicKey)));
    }
    if (this.closed) return;
    const { voiceId, code } = this.credentials;
    const { me } = this.room;
    if (this.room.voice.relay.keys?.[me] !== this.publicKey) {
      await this.send('relay-key', { voiceId, publicKey: this.publicKey });
    }
    if (this.closed) return;
    const peerKey = this.room.voice.relay.keys?.[1 - me];
    if (!peerKey) return;
    const remote = await subtle.importKey('raw', binary(peerKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = await subtle.deriveBits({ name: 'ECDH', public: remote }, this.keyPair.privateKey, 256);
    const material = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    const encoder = new TextEncoder();
    const info = encoder.encode('Jianke audio relay v1');
    const salt = encoder.encode(`${code}/${voiceId}`);
    const key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    if (this.closed) return;
    this.sendData = encoder.encode(`${voiceId}/${me}`);
    this.receiveData = encoder.encode(`${voiceId}/${1 - me}`);
    this.key = key;
    this.startCapture();
    if (this.watchSeat === undefined || me === 1) this.schedulePull(0);
  }

  setTrack(track) {
    if (this.closed || this.track === track) return;
    this.stopCapture();
    this.track = track;
    this.startCapture();
  }

  startCapture() {
    if (this.closed || !this.key || this.track?.readyState !== 'live' || this.capture) return;
    const capture = { track: this.track };
    this.capture = capture;
    this.connectCapture(capture).catch(() => {
      if (this.capture !== capture) return;
      this.stopCapture();
      this.update('备用语音无法读取麦克风，请检查浏览器权限。');
    });
  }

  async connectCapture(capture) {
    const context = this.contextForAudio();
    if (!this.useLegacyCapture && context.audioWorklet && typeof AudioWorkletNode === 'function') {
      try {
        if (!captureWorklets.has(context)) captureWorklets.set(context, context.audioWorklet.addModule(import.meta.url));
        await captureWorklets.get(context);
        if (this.capture !== capture) return;
        capture.processor = new AudioWorkletNode(context, 'jianke-relay-capture', { outputChannelCount: [1] });
        capture.processor.port.onmessage = event => this.queueFrame(event.data, capture);
      } catch {
        // Older Safari releases support the callback-based capture path.
      }
    }
    if (this.capture !== capture) return;
    if (!capture.processor) {
      const frames = new CaptureFrames(context.sampleRate, frame => this.queueFrame(frame, capture));
      capture.processor = context.createScriptProcessor(2048, 1, 1);
      capture.processor.onaudioprocess = event => frames.write(event.inputBuffer.getChannelData(0));
    }
    capture.source = context.createMediaStreamSource(new MediaStream([capture.track]));
    capture.source.connect(capture.processor);
    capture.processor.connect(context.destination);
    if (this.watchSeat !== undefined) {
      if (context.state !== 'running') context.resume().catch(() => {});
      if (capture.processor.port && typeof context.createScriptProcessor === 'function') {
        capture.watchdog = setTimeout(() => {
          if (this.capture !== capture) return;
          this.useLegacyCapture = true;
          this.stopCapture();
          this.startCapture();
        }, 2200);
      }
    }
  }

  stopCapture() {
    const capture = this.capture;
    this.capture = undefined;
    this.pendingFrames.length = 0;
    clearTimeout(this.pushTimer);
    this.pushTimer = undefined;
    this.pushController?.abort();
    if (!capture) return;
    clearTimeout(capture.watchdog);
    capture.source?.disconnect();
    capture.processor?.disconnect();
    if (capture.processor?.port) capture.processor.port.close();
    else if (capture.processor) capture.processor.onaudioprocess = null;
  }

  queueFrame(frame, capture) {
    if (this.closed || this.capture !== capture || capture.track.readyState !== 'live' || !this.room.players[this.room.me]?.mic) return;
    clearTimeout(capture.watchdog);
    this.pendingFrames.push({ frame, time: performance.now() });
    if (this.pendingFrames.length > captureBacklog) this.pendingFrames.shift();
    if (this.sending || performance.now() < (this.pushAfter ?? 0)) return;
    if (this.pendingFrames.length >= 2) {
      clearTimeout(this.pushTimer);
      this.pushTimer = undefined;
      this.sendFrames();
    } else {
      this.pushTimer = setTimeout(() => {
        this.pushTimer = undefined;
        this.sendFrames();
      }, 225);
    }
  }

  async sendFrames() {
    if (this.sending || this.closed || !this.pendingFrames.length) return;
    this.sending = true;
    try {
      while (!this.closed && this.pendingFrames.length) {
        const capture = this.capture;
        const oldest = performance.now() - 900;
        const frames = this.pendingFrames.splice(0).filter(entry => entry.time >= oldest);
        if (!frames.length) continue;
        const packets = await Promise.all(frames.map(async ({ frame }) => {
          const nonce = crypto.getRandomValues(new Uint8Array(nonceSize));
          const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: this.sendData }, this.key, frame);
          const packet = new Uint8Array(voicePacketSize);
          packet.set(nonce);
          packet.set(new Uint8Array(encrypted), nonceSize);
          return base64(packet);
        }));
        if (this.capture !== capture || this.closed) continue;
        this.pushController = new AbortController();
        const response = await this.exchange({ action: 'push', ...(packets.length === 1 ? { packet: packets[0] } : { packets }) }, this.pushController);
        if (!response) {
          this.pushAfter = performance.now() + 1500;
          return;
        }
      }
    } catch (error) {
      if (error.retryDelay) this.pushAfter = performance.now() + error.retryDelay;
      // Keep unsent frames, but skip retransmitting packets the server may already have received.
    } finally {
      this.pushController = undefined;
      this.sending = false;
      if (this.pendingFrames.length && performance.now() >= (this.pushAfter ?? 0)) this.sendFrames();
    }
  }

  async exchange(values, controller) {
    const timeout = setTimeout(() => controller.abort(), values.action === 'pull' ? 3500 : 2500);
    try {
      const response = await fetch('/api/relay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ ...this.credentials, ...values }), signal: controller.signal
      });
      if (response.headers.get('X-Jianke-Site') === 'paused') {
        this.destroy();
        return null;
      }
      if (response.status === 403 || response.status === 404) {
        if (!this.closed) {
          this.clearPlayback();
          this.update('备用语音已断开。', false);
        }
        return null;
      }
      if (!response.ok) {
        const retry = response.headers.get('Retry-After');
        throw Object.assign(new Error('备用语音连接暂时中断。'), {
          retryDelay: response.status === 503 ? (Number(retry) || 2) * 1000 + Math.random() * 500 : 0
        });
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  schedulePull(delay) {
    if (this.closed || this.pullTimer || this.pullController) return;
    this.pullTimer = setTimeout(() => {
      this.pullTimer = undefined;
      this.pull();
    }, delay);
  }

  async pull() {
    let retryDelay = 0;
    if (this.closed || this.pullController) return;
    const controller = new AbortController();
    this.pullController = controller;
    const started = performance.now();
    try {
      const response = await this.exchange({ action: 'pull', after: this.after }, controller);
      if (this.closed) return;
      if (!response) {
        this.failures += 1;
        retryDelay = 1500;
        return;
      }
      if (!Array.isArray(response.packets)) throw new Error('备用语音响应无效。');
      this.failures = 0;
      this.update('已通过备用线路连接语音。', true);
      const packets = response.packets.filter(packet => Number.isSafeInteger(packet.seq) && packet.seq > this.after);
      if (packets.length) {
        this.after = Math.max(...packets.map(packet => packet.seq));
        const arrived = performance.now();
        if (this.lastPacketAt !== undefined) {
          this.playbackLead = adaptivePlaybackLead(this.playbackLead ?? playbackLead,
            (arrived - this.lastPacketAt) / 1000, packets.length);
        }
        this.lastPacketAt = arrived;
      }
      this.updateAudioState();
      if (!this.muted && !this.audioBlocked) {
        for (const { packet } of packets.slice(-5)) await this.decryptAndPlay(packet);
      }
    } catch (error) {
      retryDelay = error.retryDelay ?? 0;
      if (!this.closed) {
        this.failures += 1;
        if (this.failures >= 3) this.update('备用语音暂时断开，正在重连…', false);
      }
    } finally {
      this.pullController = undefined;
      const peerMic = this.room?.players[1 - this.room.me]?.mic;
      const cadence = peerMic ? (this.watchSeat === undefined ? 320 : 450) : 1300;
      const delay = this.failures ? Math.min(2500, this.failures * 350) : Math.max(40, cadence - (performance.now() - started));
      this.schedulePull(Math.max(delay, retryDelay));
    }
  }

  async decryptAndPlay(packet) {
    if (this.closed || this.muted || this.context?.state !== 'running') return;
    try {
      const bytes = binary(packet);
      if (bytes.length !== voicePacketSize) return;
      const decoded = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, nonceSize), additionalData: this.receiveData },
        this.key, bytes.subarray(nonceSize));
      if (this.closed || this.muted || this.context.state !== 'running') return;
      const context = this.context;
      const now = context.currentTime;
      if (this.nextPlayback > now + 1.10) return;
      const start = this.nextPlayback > now + .015 ? this.nextPlayback : now + (this.playbackLead ?? playbackLead);
      const samples = new Uint8Array(decoded);
      const buffer = context.createBuffer(1, samples.length, sampleRateHz);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i += 1) channel[i] = decodeSample(samples[i]);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.output);
      source.onended = () => { this.playing.delete(source); source.disconnect(); };
      this.playing.add(source);
      source.start(start);
      this.nextPlayback = start + buffer.duration;
      if (!this.receivedAudio) {
        this.receivedAudio = true;
        this.onChange();
      }
    } catch {
      // Ignore malformed or unauthenticated audio.
    }
  }

  clearPlayback() {
    this.receivedAudio = false;
    for (const source of this.playing) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.playing.clear();
    this.nextPlayback = 0;
    this.lastPacketAt = undefined;
    this.playbackLead = undefined;
  }

  setMuted(muted) {
    if (this.closed || this.muted === muted) return;
    this.muted = muted;
    if (this.output) this.output.gain.value = muted ? 0 : 1;
    if (muted) this.clearPlayback();
    this.updateAudioState();
    this.onChange();
  }

  async listen() {
    if (this.closed) return;
    if (this.muted) this.setMuted(false);
    else if (this.context?.state === 'running') this.setMuted(true);
    if (!this.muted) await this.unlock();
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.keyRetry);
    clearTimeout(this.pullTimer);
    this.pullController?.abort();
    this.stopCapture();
    this.clearPlayback();
    if (this.context) {
      this.context.removeEventListener?.('statechange', this.onContextChange);
      this.output?.disconnect();
      if (this.ownsContext) this.context.close().catch(() => {});
    }
    this.track = undefined;
    this.room = undefined;
    this.keyPair = undefined;
    this.key = undefined;
  }
}
