const speechBitrate = 32_000;
const weakNetworkBitrate = 16_000;
const speechStatsInterval = 3000;

export class RoomVoice {
  constructor(audio, send, onChange, { direction = 'sendrecv', track, relay } = {}) {
    this.audio = audio;
    this.send = send;
    this.onChange = onChange;
    this.status = '双方已同意语音。请按需开启麦克风。';
    this.closed = false;
    this.muted = false;
    this.direction = direction;
    this.track = track;
    this.relay = relay;
    this.pending = [];
    this.outgoingCandidates = [];
    this.work = Promise.resolve();
    this.retries = 0;
  }

  get connectionState() {
    return this.connection?.connectionState ?? this.connection?.iceConnectionState;
  }

  get directConnected() {
    return ['connected', 'completed'].includes(this.connectionState);
  }

  update(message) {
    if (!this.closed) {
      this.status = message;
      this.onChange();
    }
  }

  async open(room) {
    if (!window.RTCPeerConnection) throw new Error('此浏览器不支持实时语音。');
    const config = await this.send('voice-config', {});
    if (this.closed || this.relayActive) return;
    if (!Array.isArray(config?.iceServers)) throw new Error('暂时无法读取语音配置。');
    const connection = new RTCPeerConnection({ iceServers: config.iceServers });
    this.hasRelay = config.iceServers.some(server => [server.urls].flat().some(url => /^turns?:/.test(url)));
    if (this.hasRelay && this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = undefined;
      this.scheduleFallback();
    }
    this.connection = connection;
    connection.onicecandidate = ({ candidate }) => {
      if (!candidate || this.closed || this.relayActive) return;
      const data = { candidate: candidate.toJSON() };
      if (this.descriptionSent) this.send('signal', { data }).catch(() => {});
      else this.outgoingCandidates.push(data);
    };
    connection.ontrack = ({ track, streams }) => {
      if (this.closed || this.relayActive || !this.audio) return;
      this.remoteTrack = track;
      this.audio.srcObject = streams[0] ?? new MediaStream([track]);
      this.audio.muted = this.muted;
      if (!this.muted) this.play();
    };
    const updateState = () => {
      if (this.closed || this.relayActive) return;
      const messages = {
        checking: '正在建立语音连接…',
        completed: '语音已连接',
        connecting: '正在建立语音连接…',
        connected: '语音已连接',
        disconnected: '语音暂时中断，正在恢复…',
        failed: '语音连接失败，请重试语音。'
      };
      const state = this.connectionState;
      if (messages[state]) this.update(messages[state]);
      if (state === 'connected' || state === 'completed') {
        clearTimeout(this.retryTimer);
        clearTimeout(this.fallbackTimer);
        this.retryTimer = undefined;
        this.retryAt = undefined;
        this.fallbackTimer = undefined;
        this.retries = 0;
        this.scheduleSpeechCheck(0);
      } else if (state === 'failed' || state === 'disconnected') {
        this.scheduleRetry(state === 'failed' ? 100 : 3500);
        this.scheduleFallback();
      }
    };
    connection.onconnectionstatechange = updateState;
    connection.oniceconnectionstatechange = updateState;
    this.update('正在建立语音连接…');
    this.scheduleRetry(14_000);
    if (room.me === 0) {
      this.sender = connection.addTransceiver('audio', { direction: this.direction }).sender;
      await this.attachTrack();
      await this.offer();
    }
  }

  async offer(restart = false) {
    const connection = this.connection;
    if (!connection || this.closed || this.relayActive) return;
    if (restart && connection.signalingState === 'have-local-offer') await connection.setLocalDescription({ type: 'rollback' });
    if (connection.signalingState !== 'stable') return;
    if (restart && this.hasRelay) connection.setConfiguration({ ...connection.getConfiguration(), iceTransportPolicy: 'relay' });
    await this.sendDescription(await connection.createOffer({ iceRestart: restart }));
  }

  async sendDescription(description) {
    if (this.closed || this.relayActive) return;
    this.descriptionSent = false;
    this.outgoingCandidates = [];
    await this.connection.setLocalDescription(description);
    if (this.closed || this.relayActive) return;
    await this.send('signal', { data: { description: this.connection.localDescription.toJSON() } });
    if (this.closed || this.relayActive) return;
    this.descriptionSent = true;
    for (const data of this.outgoingCandidates.splice(0)) this.send('signal', { data }).catch(() => {});
  }

  async absorb(data) {
    const connection = this.connection;
    if (data.restart) {
      await this.offer(true);
    } else if (data.description) {
      await connection.setRemoteDescription(data.description);
      for (const candidate of this.pending.splice(0)) await connection.addIceCandidate(candidate).catch(() => {});
      if (data.description.type === 'offer') {
        if (this.direction !== 'recvonly') this.sender = connection.getTransceivers().find(item => item.receiver.track.kind === 'audio')?.sender;
        await this.attachTrack();
        await this.sendDescription(await connection.createAnswer());
      }
    } else if (connection.remoteDescription) {
      await connection.addIceCandidate(data.candidate).catch(() => {});
    } else {
      this.pending.push(data.candidate);
    }
  }

  accept(room, signals) {
    if (this.closed || room.players.length !== 2) return;
    this.room = room;
    if (this.relay) {
      const relayState = room.voice?.relay;
      this.relayRequested = relayState?.enabled === true;
      if (this.relayRequested && !this.relayActive) this.relay.setMuted(this.muted || this.directConnected);
      this.relay.sync(room);
      if (this.relayRequested && relayState.keys?.every(Boolean) && relayState.keys.length === 2 && this.relay.connected) {
        if (!this.relayActive) {
          this.relayActive = true;
          this.stopDirect();
          this.relay.setMuted(this.muted);
        }
        return;
      }
      this.scheduleFallback();
    }
    const needsOffer = !this.connection && !this.opening && room.me === 0 && room.players.some(player => player.mic);
    const nextTrack = this.track?.() ?? null;
    const changed = this.track && this.sender && nextTrack !== this.sender.track;
    if (!signals.length && !needsOffer && !changed) return;
    if (needsOffer) this.opening = true;
    this.work = this.work.then(async () => {
      if (this.closed || this.relayActive) return;
      if (!this.connection) await this.open(room);
      if (this.closed || this.relayActive) return;
      if (changed) await this.attachTrack();
      for (const signal of signals) {
        if (this.closed || this.relayActive) return;
        try {
          await this.absorb(signal.data);
        } catch {
          this.update('语音连接中断，请重试语音。');
        }
      }
    }).catch(error => this.update(error.message || '语音连接失败。')).finally(() => { if (needsOffer) this.opening = false; });
  }

  scheduleRetry(delay) {
    if (this.closed || this.relayActive || this.retries >= 2 || this.room?.me !== 0) return;
    const due = Date.now() + delay;
    if (this.retryTimer && this.retryAt <= due) return;
    clearTimeout(this.retryTimer);
    this.retryAt = due;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.retryAt = undefined;
      if (this.closed || this.relayActive || this.directConnected) return;
      this.retries += 1;
      this.retry(this.room).finally(() => this.scheduleRetry(9000));
    }, delay);
  }

  resumeNetwork() {
    if (this.closed || this.relayActive || this.directConnected || this.opening ||
        !this.room?.players.some(player => player.mic)) return;
    this.retries = 0;
    this.scheduleRetry(100);
    this.scheduleFallback();
  }

  retry(room) {
    this.update('正在重新连接语音…');
    this.work = this.work.then(async () => {
      if (this.closed || this.relayActive) return;
      if (!this.connection && room.me === 0) await this.open(room);
      else if (room.me === 0) await this.offer(true);
      else await this.send('signal', { data: { restart: true } });
    }).catch(error => this.update(error.message || '语音连接失败。'));
    return this.work;
  }

  scheduleFallback() {
    if (!this.relay || this.closed || this.relayRequested || this.fallbackTimer || this.directConnected ||
      !this.room?.players.some(player => player.mic)) return;
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = undefined;
      if (!this.closed && !this.relayRequested && !this.directConnected && this.room?.players.some(player => player.mic)) this.useFallback();
    }, this.hasRelay ? 22_000 : 10_000);
  }

  async useFallback() {
    if (!this.relay || this.closed || this.enablingRelay) return;
    this.enablingRelay = true;
    this.onChange();
    try {
      await this.relay.activate();
    } catch (error) {
      this.update(error.message || '暂时无法启用兼容语音。');
    } finally {
      this.enablingRelay = false;
      if (!this.closed) this.onChange();
    }
  }

  async attachTrack() {
    const track = this.track ? this.track() : this.stream?.getAudioTracks()[0];
    if (this.sender && this.sender.track !== (track ?? null)) await this.sender.replaceTrack(track ?? null);
    if (track) this.scheduleSpeechCheck(0);
    else {
      clearTimeout(this.speechTimer);
      this.speechTimer = undefined;
      this.poorSpeechSamples = 0;
      this.goodSpeechSamples = 0;
    }
  }

  scheduleSpeechCheck(delay = speechStatsInterval) {
    const sender = this.sender;
    if (this.closed || !this.directConnected || !sender?.track || !sender.getParameters || !sender.setParameters ||
        this.speechTimer || this.checkingSpeech) return;
    this.speechTimer = setTimeout(async () => {
      this.speechTimer = undefined;
      this.checkingSpeech = true;
      try {
        await this.tuneSpeech(sender);
      } catch {
        // Older implementations can reject changes during negotiation.
      } finally {
        this.checkingSpeech = false;
        this.scheduleSpeechCheck();
      }
    }, delay);
  }

  async tuneSpeech(sender) {
    if (this.closed || sender !== this.sender || !sender.track || !this.directConnected) return;
    const report = await sender.getStats?.();
    if (this.closed || sender !== this.sender || !sender.track || !this.directConnected) return;
    const remote = report && [...report.values()].find(row => row.type === 'remote-inbound-rtp');
    const loss = remote?.fractionLost;
    const rtt = remote?.roundTripTime;
    const poor = (Number.isFinite(loss) && loss >= .08) || (Number.isFinite(rtt) && rtt >= .45);
    const good = !poor && (Number.isFinite(loss) || Number.isFinite(rtt)) &&
      (!Number.isFinite(loss) || loss <= .03) && (!Number.isFinite(rtt) || rtt <= .25);
    this.poorSpeechSamples = poor ? (this.poorSpeechSamples ?? 0) + 1 : 0;
    this.goodSpeechSamples = good ? (this.goodSpeechSamples ?? 0) + 1 : 0;

    if (this.poorSpeechSamples >= 2) this.speechRate = weakNetworkBitrate;
    if (this.goodSpeechSamples >= 3) this.speechRate = speechBitrate;
    const rate = this.speechRate ?? speechBitrate;
    const parameters = sender.getParameters();
    if (!parameters?.encodings?.length || parameters.encodings.every(encoding => encoding.maxBitrate === rate)) return;
    for (const encoding of parameters.encodings) encoding.maxBitrate = rate;
    await sender.setParameters(parameters);
  }

  async play() {
    if (!this.audio?.srcObject || this.audio.muted) return;
    try {
      await this.audio.play();
      this.audioBlocked = false;
    } catch {
      this.audioBlocked = true;
    }
    if (!this.closed) this.onChange();
  }

  async microphone() {
    if (this.stream) {
      const stream = this.stream;
      this.stream = null;
      stream.getTracks().forEach(track => track.stop());
      this.relay?.setTrack(null);
      await this.attachTrack();
      await this.send('mic', { on: false });
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前页面无法调用麦克风。请用系统浏览器打开双人节拍的 HTTPS 地址。');
    }
    this.relay?.unlock().catch(() => {});
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    if (this.closed) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    this.openingStream = stream;
    this.micStatus = '麦克风已授权，正在同步到房间…';
    this.onChange();
    let acknowledged = false;
    try {
      for (const delay of [0, 800, 2200]) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (this.closed) return;
        try {
          const result = await this.send('mic', { on: true });
          if (this.closed) return;
          if (result?.state !== 'room' || !result.room.players[result.room.me]?.mic) throw new Error('语音房间已结束，请重新申请语音。');
          acknowledged = true;
          break;
        } catch (error) {
          if (this.closed) return;
          const transient = error.status === 429 || error.status >= 500 || ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name);
          if (!transient) throw error;
          if (delay === 2200) throw new Error('麦克风已授权，但房间服务器暂时未响应。请稍后重试开启。');
        }
      }
      this.stream = stream;
      await this.attachTrack();
      if (!this.closed) this.relay?.setTrack(stream.getAudioTracks()[0]);
      await this.play();
    } catch (error) {
      this.stream = null;
      this.relay?.setTrack(null);
      if (acknowledged || !error.status) this.send('mic', { on: false }).catch(() => {});
      throw error;
    } finally {
      this.openingStream = undefined;
      if (this.stream !== stream) stream.getTracks().forEach(track => track.stop());
      this.micStatus = undefined;
    }
    stream.getAudioTracks()[0].addEventListener('ended', () => {
      if (!this.closed && this.stream === stream) this.microphone().catch(() => {});
    });
  }

  async listen() {
    if (this.relayActive) return this.relay.listen();
    this.relay?.unlock().catch(() => {});
    if (!this.audioBlocked) this.muted = !this.muted;
    this.audio.muted = this.muted;
    if (!this.muted) await this.play();
    if (!this.closed) this.onChange();
  }

  destroy() {
    this.closed = true;
    this.relay?.destroy();
    this.stream?.getTracks().forEach(track => track.stop());
    this.openingStream?.getTracks().forEach(track => track.stop());
    this.stopDirect();
  }

  stopDirect() {
    this.remoteTrack = undefined;
    clearTimeout(this.retryTimer);
    clearTimeout(this.fallbackTimer);
    clearTimeout(this.speechTimer);
    this.retryTimer = undefined;
    this.retryAt = undefined;
    this.fallbackTimer = undefined;
    this.speechTimer = undefined;
    this.speechRate = undefined;
    this.poorSpeechSamples = 0;
    this.goodSpeechSamples = 0;
    const connection = this.connection;
    this.connection = undefined;
    this.sender = undefined;
    connection?.close();
    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
      this.audio.muted = false;
    }
  }
}

export function voiceError(error) {
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return '网站未取得麦克风权限。请在地址栏的网站权限中允许麦克风。如果在应用内打开，请改用系统浏览器重试。';
  if (error.name === 'NotFoundError') return '没有找到可用的麦克风。';
  if (error.name === 'NotReadableError') return '麦克风暂时不可用，请检查是否被其他应用占用。';
  return error.message || '暂时无法打开麦克风。';
}
