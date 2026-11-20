import { RoomVoice } from './voice.js';
import { RelayVoice } from './relay.js';
import { coachHints, cues, focusOptions, receiverReplies, tempos } from './pace.js';
import { roles } from './preferences.js';
import { RoomChat } from './chat.js';

export const watchStatuses = { waiting: '等待开局', countdown: '即将开始', playing: '对局进行中', paused: '已暂停', finished: '本局结束' };

function watchClock(milliseconds) {
  if (milliseconds == null) return '';
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function spectatorRelay(credentials, request, seat, send, onChange, sharedContext) {
  return new RelayVoice({ ...credentials, code: 'spectator/' + seat, voiceId: request, watchSeat: seat, sharedContext,
    send: (_, { publicKey }) => send(publicKey), onChange });
}

function syncSpectatorRelay(relay, request, seat, keys, mic, me) {
  relay.sync({ me, players: [{ mic }, {}], voice: { id: request, status: 'approved',
    relay: { enabled: true, keys: [keys?.[seat], keys?.[seat + 2]] } } });
}

export class WatchView {
  constructor(element, send, leave, title = '旁观视角', credentials) {
    this.element = element;
    this.send = send;
    this.leave = leave;
    this.peers = [];
    this.relays = [];
    this.fallbackTimers = [];
    this.credentials = credentials;
    element.hidden = false;
    element.innerHTML = `<div class="watch-heading"><h2></h2><button type="button" data-watch="leave" class="button outline">退出旁观</button></div>
      <div class="watch-stage"><span class="watch-phase"></span><strong class="watch-cue"></strong><time></time><p class="watch-players"></p></div>
      <section class="watch-interaction" aria-label="对局互动" hidden>
        <div><h3>领拍者指令</h3><div class="watch-controls"></div><p class="watch-hint"></p></div>
        <div><h3>跟拍者反馈</h3><p class="watch-reply" aria-live="polite"></p></div>
      </section>
      <section class="room-chat" aria-label="房间公屏"></section>
      <p class="watch-status" role="status"></p><div class="watch-actions">
        <button type="button" data-watch="play" class="button outline" hidden>播放旁听语音</button>
        <button type="button" data-watch="beat" class="button outline" aria-pressed="false">开启观战节拍声</button></div>
      <audio autoplay playsinline></audio><audio autoplay playsinline></audio>`;
    element.querySelector('h2').textContent = title;
    this.chat = new RoomChat(element.querySelector('.room-chat'));
    this.audios = [...element.querySelectorAll('audio')];
    this.onClick = event => {
      const action = event.target.closest('[data-watch]')?.dataset.watch;
      if (action === 'leave') this.leave();
      if (action === 'beat') this.toggleBeat();
      if (action === 'play') this.peers.forEach((peer, seat) => {
        if (!peer.closed && peer.remoteTrack && !peer.remoteTrack.muted) peer.play();
        if (this.room?.microphones?.[seat] && (!peer.remoteTrack || peer.remoteTrack.muted || this.relays[seat])) {
          this.enableFallback(seat)?.unlock().catch(() => {});
        }
      });
    };
    element.addEventListener('click', this.onClick);
  }

  async toggleBeat() {
    const button = this.element.querySelector('[data-watch="beat"]');
    this.beatOn = !this.beatOn;
    if (this.beatOn) {
      try {
        const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        this.beatContext ??= new Context();
        await this.beatContext.resume();
      } catch { this.beatOn = false; }
    }
    if (this.destroyed) return;
    button.textContent = this.beatOn ? '关闭观战节拍声' : '开启观战节拍声';
    button.setAttribute('aria-pressed', String(this.beatOn));
    this.scheduleBeat();
  }

  scheduleBeat() {
    clearTimeout(this.beatTimer);
    this.beatTimer = undefined;
    const beat = this.beatState;
    if (!this.beatOn || !beat || this.beatContext?.state !== 'running') return;
    const interval = 60_000 / beat.bpm;
    const now = performance.now();
    const delay = interval - ((now - beat.anchor) % interval + interval) % interval;
    this.beatTimer = setTimeout(() => {
      this.beatTimer = undefined;
      if (performance.now() - beat.received > 4000) return;
      const context = this.beatContext;
      const tone = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime;
      tone.frequency.value = 820;
      gain.gain.setValueAtTime(.12, start);
      gain.gain.exponentialRampToValueAtTime(.001, start + .065);
      tone.connect(gain).connect(context.destination);
      tone.start(start);
      tone.stop(start + .07);
      this.scheduleBeat();
    }, Math.max(15, delay));
  }

  renderInteraction(room) {
    const section = this.element.querySelector('.watch-interaction');
    const control = section.querySelector('.watch-controls');
    const info = room.interaction;
    section.hidden = !info;
    if (!info) return;
    const active = info.selectedTempo ? String(info.selectedTempo) : info.manual ?? 'auto';
    if (control.dataset.active !== active) {
      const chips = [...Object.keys(tempos).map(bpm => [bpm, bpm + ' BPM']), ['fast', '加快'], ['slow', '放慢'], ['stop', '停拍'], ['auto', '自动']];
      control.replaceChildren(...chips.map(([value, label]) => {
        const chip = document.createElement('span');
        chip.textContent = label;
        if (value === active) chip.setAttribute('aria-current', 'true');
        return chip;
      }));
      control.dataset.active = active;
    }
    section.querySelector('.watch-hint').textContent = [info.intensity ? '强度 ' + info.intensity + ' 档' : '',
      focusOptions[info.focus], coachHints[info.hint]].filter(Boolean).join(' · ');
    const reply = section.querySelector('.watch-reply');
    const label = receiverReplies[info.reply] ?? '等待公开反馈。';
    if (reply.textContent !== label) reply.textContent = label;
  }

  status(text) {
    const element = this.element.querySelector('.watch-status');
    if (element.textContent !== text) element.textContent = text;
  }

  enableFallback(seat) {
    if (!this.credentials || !this.request) return;
    clearTimeout(this.fallbackTimers[seat]);
    this.fallbackTimers[seat] = undefined;
    if (this.relays[seat]) return this.relays[seat];
    const request = this.request;
    const relay = spectatorRelay(this.credentials, request, seat,
      relayKey => this.send('watch-receive', { request, seat, data: { relayKey } }), () => {
        if (relay.receivedAudio && !this.peers[seat].closed) this.peers[seat].destroy();
        this.renderAudio();
      });
    this.relays[seat] = relay;
    syncSpectatorRelay(relay, request, seat, this.room.relayKeys, this.room.microphones?.[seat], 1);
    this.renderAudio();
    return relay;
  }

  renderAudio() {
    if (!this.request) return this.status('房间未开放语音旁听。');
    if (this.relays.some(relay => relay?.audioBlocked) || this.peers.some(peer => peer.audioBlocked && !peer.closed)) {
      return this.status('请点「播放旁听语音」开启声音。');
    }
    if (this.relays.some((relay, seat) => relay?.receivedAudio && this.room?.microphones?.[seat]) ||
      this.audios.some((audio, seat) => this.peers[seat]?.remoteTrack?.muted === false && !audio.paused)) {
      return this.status('正在播放旁听语音。');
    }
    if (!this.room?.microphones?.some(Boolean)) return this.status('等待房间玩家开启麦克风。');
    const speakerReady = this.relays.some((relay, seat) => relay && this.room.relayKeys?.[seat]);
    this.status(speakerReady ? '备用线路已配对，等待播放器收到说话声音…'
      : this.relays.some(Boolean) ? '等待房间玩家接入加密备用线路…' : '正在连接旁听语音…');
  }

  stopAudio() {
    this.fallbackTimers.forEach(timer => clearTimeout(timer));
    this.peers.forEach(peer => peer.destroy());
    this.relays.forEach(relay => relay?.destroy());
    this.fallbackTimers = [];
    this.relays = [];
  }

  accept(snapshot) {
    const { room, signals, now } = snapshot;
    this.room = room;
    this.chat.accept(room.chat, room.players.findIndex(player => player.role === 'controller'));
    this.renderInteraction(room);
    const clock = performance.now();
    if (room.beat && this.beatState?.origin === room.beat.origin && this.beatState.bpm === room.beat.bpm) {
      this.beatState.received = clock;
      if (!this.beatTimer) this.scheduleBeat();
    } else {
      this.beatState = room.beat ? { ...room.beat, anchor: clock - (now - room.beat.origin), received: clock } : null;
      this.scheduleBeat();
    }
    const next = room.listen === 'approved' ? room.request : null;
    if (this.request !== next) {
      this.stopAudio();
      this.peers = next ? this.audios.map((audio, seat) => new RoomVoice(audio,
        (action, values) => this.send(action === 'voice-config' ? 'watch-config' : 'watch-receive', { ...values, request: next, seat }),
        () => this.renderAudio(), { direction: 'recvonly' })) : [];
      this.request = next;
    }
    const fakeRoom = { me: 1, players: room.players };
    this.peers.forEach((peer, seat) => {
      const mic = room.microphones?.[seat];
      const relay = this.relays[seat];
      if (!peer.closed) peer.accept(fakeRoom, signals.filter(signal => signal.seat === seat && signal.request === next));
      if (relay) {
        syncSpectatorRelay(relay, next, seat, room.relayKeys, mic, 1);
      } else {
        if (this.credentials && mic && (!peer.remoteTrack || peer.remoteTrack.muted) && !this.fallbackTimers[seat]) {
          this.fallbackTimers[seat] = setTimeout(() => {
            this.fallbackTimers[seat] = undefined;
            if (this.request === next && this.room.microphones?.[seat] && (!peer.remoteTrack || peer.remoteTrack.muted)) this.enableFallback(seat);
          }, 6500);
        }
      }
    });
    this.element.querySelector('.watch-phase').textContent = watchStatuses[room.status];
    this.element.querySelector('.watch-cue').textContent = room.status === 'playing' ? cues[room.cue]?.title ?? '' : '';
    this.element.querySelector('time').textContent = watchClock(room.remaining);
    this.element.querySelector('.watch-players').textContent = room.players.map(player => `${player.nickname || '游客'} · ${roles[player.role]}`).join(' / ');
    this.renderAudio();
    this.element.querySelector('[data-watch="play"]').hidden = room.listen !== 'approved';
  }

  destroy() {
    this.destroyed = true;
    this.stopAudio();
    clearTimeout(this.beatTimer);
    this.beatContext?.close().catch(() => {});
    this.element.removeEventListener('click', this.onClick);
    this.element.replaceChildren();
    this.element.hidden = true;
  }
}

export class AudienceVoice {
  constructor(send, track, credentials, sharedContext) {
    this.send = send;
    this.track = track;
    this.credentials = credentials;
    this.sharedContext = sharedContext;
    this.peers = new Map();
  }

  accept(room, signals) {
    const active = new Map((room.audience?.viewers ?? []).filter(viewer => viewer.status === 'approved').map(viewer => [viewer.id, viewer]));
    for (const [id, connection] of this.peers) {
      if (active.get(id)?.request !== connection.request) {
        connection.peer.destroy();
        connection.relay?.destroy();
        this.peers.delete(id);
      }
    }
    for (const [listener, { request, relayKeys }] of active) {
      if (!this.peers.has(listener)) this.peers.set(listener, { request, peer: new RoomVoice(null,
        (action, values) => this.send(action === 'voice-config' ? 'voice-config' : 'watch-send', { ...values, listener, request }),
        () => {}, { direction: 'sendonly', track: this.track }) });
      const connection = this.peers.get(listener);
      const seat = room.me;
      if (!connection.peer.closed) connection.peer.accept({ me: 0, players: [{ mic: !!this.track() }, {}] },
        signals.filter(signal => signal.listener === listener && signal.request === request));
      if (this.credentials && relayKeys?.[seat + 2]) {
        connection.relay ??= spectatorRelay(this.credentials, request, seat,
          relayKey => this.send('watch-send', { listener, request, data: { relayKey } }), () => {}, this.sharedContext);
        connection.relay.setTrack(this.track());
        syncSpectatorRelay(connection.relay, request, seat, relayKeys, room.players[seat]?.mic, 0);
      }
    }
  }

  destroy() {
    for (const { peer, relay } of this.peers.values()) {
      peer.destroy();
      relay?.destroy();
    }
    this.peers.clear();
  }
}
