import { cues, getProgress } from '../public/pace.js';
import { genders } from '../public/preferences.js';
import { cleanNickname, clearPlayerInvitations, lifetime, locate, membershipLifetime, problem, result, sweep, touchEvery } from './game.mjs';

export const watchRoomActions = ['watch-open', 'watch-audio-open', 'watch-media-allow', 'watch-media-share', 'watch-vote', 'watch-send'];
export const watcherActions = ['watch-join', 'watch-sync', 'watch-leave', 'watch-listen', 'watch-receive', 'watch-config'];
const maxWatchers = 12;

function publicViewerCount(watch) {
  return watch?.viewers.filter(viewer => !viewer.admin).length ?? 0;
}

export function publicWatch(room) {
  return room.players.length === 2 && room.players.every(player => room.watch?.openBy.includes(player.id));
}

function publicWatchAudio(room) {
  return room.voice?.status === 'approved' && publicWatch(room) && room.players.every(player => room.watch.audioBy?.includes(player.id));
}

function trimWatchSignals(watch) {
  watch.signals = watch.signals.filter(signal => watch.viewers.some(viewer => viewer.id === signal.viewer && viewer.request === signal.request));
}

export function pruneWatchers(room, now) {
  const watch = room.watch;
  if (!watch) return;
  watch.viewers = watch.viewers.filter(viewer => !viewer.admin && now - viewer.seen < lifetime);
  trimWatchSignals(watch);
}

function resetListener(viewer, shared = false) {
  viewer.request = shared ? crypto.randomUUID() : null;
  viewer.publicAudio = shared;
  delete viewer.relayKeys;
}

export function updatePublicListeners(room) {
  if (!room.watch) return;
  const shared = publicWatchAudio(room);
  for (const viewer of room.watch.viewers) {
    if (shared ? !viewer.publicAudio || !viewer.request : viewer.request || viewer.publicAudio) resetListener(viewer, shared);
  }
  trimWatchSignals(room.watch);
}

export function clearListening(room) {
  if (!room.watch) return;
  room.watch.signals = [];
  for (const viewer of room.watch.viewers) resetListener(viewer);
}

function watchStatus(room, viewer) {
  return viewer.request && viewer.publicAudio && publicWatchAudio(room) ? 'approved' : 'off';
}

export function watchMemberView(room, self) {
  const optedIn = room.watch?.openBy.includes(self) ?? false;
  return {
    optedIn,
    preferOpen: optedIn || (!room.game && !room.watch?.closedBy?.includes(self)),
    open: publicWatch(room),
    audioOptedIn: room.watch?.audioBy?.includes(self) ?? false,
    publicAudio: publicWatchAudio(room),
    viewerLimit: maxWatchers,
    viewerCount: publicViewerCount(room.watch),
    viewers: (room.watch?.viewers ?? []).map(viewer => {
      const status = watchStatus(room, viewer);
      return { id: viewer.id, nickname: viewer.nickname,
        request: status === 'approved' ? viewer.request : null, status, publicAudio: status === 'approved',
        relayKeys: status === 'approved' ? viewer.relayKeys : undefined };
    })
  };
}

function watchFrame(room, now, showCue = true) {
  const progress = getProgress(room.game, now);
  const active = progress && !progress.done;
  return {
    players: room.players.map((player, index) => ({ nickname: player.nickname, role: room.players.length === 2 ? (index === room.controller ? 'controller' : 'receiver') : 'either' })),
    status: !progress ? 'waiting' : progress.done ? 'finished' : room.game.pausedAt ? 'paused' : now < (room.game.resumeAt ?? room.game.startAt) ? 'countdown' : 'playing',
    ...(showCue ? { cue: active && progress.phase?.kind, bpm: active && progress.phase?.bpm } : {}),
    remaining: active ? progress.remaining : null
  };
}

export function activeWatchDirectory(state, now) {
  return watchDirectory(state, now, true).filter(room => ['countdown', 'playing', 'paused'].includes(room.status))
    .map(({ key, status, viewers, viewerLimit, publicAudio, roleGenders }) => ({ key, status, viewers, viewerLimit, publicAudio, roleGenders }));
}

export function watchDirectory(state, now, includeRoleGenders = false) {
  return Object.values(state.rooms).filter(room => !room.closedAt && publicWatch(room) && room.players.every(player => now - player.seen < lifetime))
    .map(room => ({ key: room.watch.key, ...watchFrame(room, now), viewers: publicViewerCount(room.watch),
      viewerLimit: maxWatchers, publicAudio: publicWatchAudio(room),
      ...(includeRoleGenders && { roleGenders: Object.fromEntries(room.players.map((player, index) => [
        index === (room.controller ?? 0) ? 'controller' : 'receiver',
        Object.hasOwn(genders, player.publicGender) ? player.publicGender : 'unspecified'
      ])) }) }));
}

function watchSignal(room, viewer, seat, action, data) {
  const { description, candidate, restart, relayKey } = data ?? {};
  const sending = action === 'watch-send';
  if (relayKey) {
    const keys = viewer.relayKeys ??= [null, null, null, null];
    const index = seat + (sending ? 0 : 2);
    if (keys[index] && keys[index] !== relayKey) return problem('旁听语音密钥已变更。', 409);
    keys[index] = relayKey;
    return;
  }
  const validDescription = description?.type === (sending ? 'offer' : 'answer') && typeof description.sdp === 'string' &&
    description.sdp.length <= 9000 && !/^m=(?!audio\s)/im.test(description.sdp);
  const validCandidate = typeof candidate?.candidate === 'string' && candidate.candidate.length <= 2000;
  if ((!validDescription && !validCandidate && (sending || restart !== true)) || JSON.stringify(data).length > 10_000) {
    return problem('旁听连接信息无效。');
  }
  const to = sending ? viewer.id : room.players[seat].id;
  room.watch.signals.push({ seq: ++room.sequence, to, viewer: viewer.id, seat, request: viewer.request, data });
  room.watch.signals = room.watch.signals.slice(-96);
}

export function takeWatchSignals(room, id, after, member = false) {
  const watch = room.watch;
  if (!watch) return [];
  if (member) watch.signals = watch.signals.filter(signal => signal.to !== id || signal.seq > after);
  return watch.signals.filter(signal => signal.to === id && signal.seq > after).map(({ seq, data, viewer, seat, request }) =>
    member ? { seq, data, listener: viewer, request } : { seq, data, seat, request });
}

export function setWatchOpen(room, id, open, details = false) {
  room.watch ??= { key: crypto.randomUUID(), openBy: [], viewers: [], signals: [] };
  const watch = room.watch;
  const wasOpen = watch.openBy.includes(id);
  watch.closedBy = (watch.closedBy ?? []).filter(player => player !== id);
  if (!open || details) {
    watch.detailsBy = (watch.detailsBy ?? []).filter(player => player !== id);
    if (open) watch.detailsBy.push(id);
  }
  if (open) {
    if (!wasOpen) watch.openBy.push(id);
    updatePublicListeners(room);
    return;
  }
  watch.closedBy.push(id);
  if (!wasOpen) return;
  watch.openBy = watch.openBy.filter(player => player !== id);
  watch.key = crypto.randomUUID();
  watch.audioBy = [];
  watch.viewers = [];
  updatePublicListeners(room);
}

export function memberWatchAction(room, input, index) {
  if (room.players.length !== 2) return problem('双方到齐后可使用旁观。', 409);
  const { id, action } = input;
  if (action === 'watch-open') {
    setWatchOpen(room, id, input.open === true, input.shareDetails === true);
    return;
  }
  if (action === 'watch-media-allow' || action === 'watch-media-share') {
    return problem('对局素材已关闭。', 403);
  }
  if (action === 'watch-audio-open') {
    const watch = room.watch ??= { key: crypto.randomUUID(), openBy: [], viewers: [], signals: [] };
    watch.audioBy = (watch.audioBy ?? []).filter(player => player !== id);
    if (input.open === true) watch.audioBy.push(id);
    updatePublicListeners(room);
    return;
  }
  if (action === 'watch-vote') return problem('请通过房间内的旁听开关设置。', 403);
  const viewer = room.watch?.viewers.find(item => !item.admin && item.id === input.listener);
  if (!viewer || watchStatus(room, viewer) !== 'approved' || viewer.request !== input.request) return problem('旁听未开放或已结束。', 403);
  return watchSignal(room, viewer, index, action, input.data);
}

export function watcherAction(state, input, now) {
  const { action, account } = input;
  if (!account || input.adult !== true) return problem('请先确认已年满 18 岁。', 403);
  if (typeof input.key !== 'string') return result({ state: 'watch-closed', now });
  const room = Object.values(state.rooms).find(candidate => !candidate.closedAt && candidate.watch?.key === input.key && publicWatch(candidate));
  if (!room) return result({ state: 'watch-closed', now });
  sweep({ rooms: { [room.code]: room }, queue: [], historyEvents: state.historyEvents }, now);
  if (room.closedAt || room.watch?.key !== input.key || !publicWatch(room)) return result({ state: 'watch-closed', now });
  const occupied = locate(state, input.id)?.players.find(player => player.id === input.id);
  if ((occupied && now - occupied.seen < membershipLifetime) || room.players.some(player => player.account === account)) return problem('请先退出对局。', 409);
  room.watch ??= { key: crypto.randomUUID(), openBy: [], viewers: [], signals: [] };
  const watch = room.watch;
  let viewer = watch.viewers.find(item => !item.admin && item.id === input.id && item.account === account);
  if (action === 'watch-join') {
    if (!viewer) {
      if (publicViewerCount(watch) >= maxWatchers) return problem(`旁观人数已满（${maxWatchers} 人）。`, 409);
      if (Object.values(state.rooms).some(other => other.watch?.viewers.some(item => item.id === input.id && now - item.seen < lifetime))) return problem('请先退出当前旁观。', 409);
      viewer = { id: input.id, account, nickname: cleanNickname(input.nickname) || '旁观者', seen: now, request: null };
      if (publicWatchAudio(room)) resetListener(viewer, true);
      watch.viewers.push(viewer);
    }
    if (state.online[account]?.id === input.id) delete state.online[account];
    clearPlayerInvitations(state, account);
  }
  if (!viewer) return result({ state: 'watch-closed', now });
  if (action === 'watch-leave') {
    watch.viewers = watch.viewers.filter(item => item.id !== viewer.id);
    watch.signals = watch.signals.filter(signal => signal.viewer !== viewer.id);
    return result({ state: 'watch-closed', now });
  }
  if (action === 'watch-config') {
    if (watchStatus(room, viewer) !== 'approved' || input.request !== viewer.request) return problem('旁听需要两位玩家同意。', 403);
    return result({ state: 'ice', now });
  }
  if (now - viewer.seen >= touchEvery) viewer.seen = now;
  if (action === 'watch-listen' && watchStatus(room, viewer) !== 'approved') return problem('房间已禁止旁听。', 403);
  if (action === 'watch-receive') {
    if (watchStatus(room, viewer) !== 'approved' || input.request !== viewer.request) return problem('旁听需要两位玩家同意。', 403);
    if (input.seat !== 0 && input.seat !== 1) return problem('无效的旁听连接。');
    const error = watchSignal(room, viewer, input.seat, action, input.data);
    if (error) return error;
  }
  const listen = watchStatus(room, viewer);
  const frame = watchFrame(room, now);
  const progress = getProgress(room.game, now);
  const tempo = frame.status === 'playing' ? progress.phase?.bpm ?? cues[frame.cue]?.bpm : 0;
  const interaction = progress && !progress.done ? {
    manual: progress.live?.kind ?? null, selectedTempo: progress.live?.bpm ?? null,
    ...(room.players.every(player => watch.detailsBy?.includes(player.id)) ? {
      reply: room.game.reply?.key, hint: room.game.hint?.key,
      intensity: room.game.intensity, focus: room.game.focus
    } : {})
  } : null;
  return result({ state: 'watching', now, room: { ...frame, viewers: publicViewerCount(watch), interaction,
    chat: room.chat?.filter(message => message.public),
    beat: tempo > 0 ? { bpm: tempo, origin: now - (progress.elapsed - progress.phaseStart) } : null,
    listen, request: listen === 'approved' ? viewer.request : null, publicAudio: listen === 'approved',
    relayKeys: listen === 'approved' ? viewer.relayKeys : undefined,
    microphones: listen === 'approved' ? room.players.map(player => !!player.mic) : undefined },
  signals: listen === 'approved' ? takeWatchSignals(room, viewer.id, input.after ?? 0) : [] });
}

export function isSiteAdmin(request, settings) {
  const permitted = String(settings.ADMIN_EMAILS ?? '').toLowerCase().split(',').map(email => email.trim()).filter(Boolean);
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  return !!request.headers.get('oai-authenticated-user-id') && !!email && permitted.includes(email);
}

export function adminSnapshot(state, now) {
  sweep(state, now);
  const active = Object.values(state.rooms).filter(room => !room.closedAt);
  const people = new Map();
  function add(player, status) {
    people.set(player.account ?? player.id, { nickname: player.nickname || '游客', status });
  }
  for (const player of Object.values(state.online)) add(player, '在大厅');
  for (const player of state.queue) add(player, '随机匹配');
  for (const room of active) {
    for (const player of room.waitlist ?? []) add(player, '候补排队');
    for (const viewer of room.watch?.viewers ?? []) if (!viewer.admin) add(viewer, '旁观');
    for (const player of room.players) add(player, '在房间');
  }
  return result({ people: [...people.values()], rooms: active.map(room => {
    const voiceStatus = room.voice?.status ?? 'off';
    return {
      code: room.code, kind: room.kind, ...watchFrame(room, now, false), seconds: room.game?.seconds ?? room.seconds,
      voiceStatus, microphones: voiceStatus === 'approved' ? room.players.filter(player => player.mic).length : 0,
      relayEnabled: voiceStatus === 'approved' && room.voice.relay?.enabled === true,
      publicWatch: publicWatch(room),
      publicAudio: publicWatchAudio(room),
      viewers: publicViewerCount(room.watch), standby: room.waitlist?.length ?? 0
    };
  }) });
}
