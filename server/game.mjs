import { voiceSampleApi } from './voice-samples.mjs';
import { cleanCustomHint, coachHints, customHintLimit, cues, defaultRoundSeconds, extensions, fitRoundSeconds, focusOptions, getProgress, maxIntensity, normalizeRoundLimits, paces, plan, receiverReplies, roundPhases, sharedRoundLimits, shortStops, tempos, validRoundLimits, validRoundSeconds, withinRoundLimits } from '../public/pace.js';
import { desiredGender, genders, normalizeProfile, roomController, voiceAgreement } from '../public/preferences.js';
import { memoryFriends } from './friends.mjs';
import { activeWatchDirectory, adminSnapshot, clearListening, isSiteAdmin, memberWatchAction, pruneWatchers, publicWatch, setWatchOpen, takeWatchSignals, updatePublicListeners, watchDirectory, watchMemberView, watcherAction, watcherActions, watchRoomActions } from './watch.mjs';
import { databaseRelay, memoryRelay, relayActions, relayBatchLimit, relayRoomAction, validRelayPacket, validRelayPublicKey } from './relay.mjs';
import { moderationNetwork, openReportContext, reportReasons, reportWindow, sealReportContext } from './moderation.mjs';
import { readReportFiles, reportFileKey, serveReportFile, validateReportFiles } from './report-files.mjs';
import { recordRound } from './history.mjs';

export const lifetime = 30_000;
export const touchEvery = 12_000;
export const membershipLifetime = 90_000;
const maxActiveRooms = 100;
const maxWaitingPlayers = 100;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const validRoomCode = /^[A-HJ-NP-Z2-9]{6}$/;
const validId = /^[0-9a-f-]{36}$/i;
const guestKeyPattern = /^[0-9a-f]{64}$/;
const lobbyLifetime = 40_000;
const lobbyTouchEvery = 20_000;
const inviteLifetime = 45_000;

const empty = () => ({ rooms: {}, queue: [] });
export const result = (value, status = 200) => ({ value, status });
export const problem = (message, status = 400) => result({ error: message }, status);
const queuedElsewhere = () => result({ error: '此身份还有排队记录，请先清除排队。', code: 'queue-conflict' }, 409);

export function sweep(state, now) {
  state.online ??= {};
  state.invitations ??= {};
  for (const [account, player] of Object.entries(state.online)) {
    if (now - player.seen >= lobbyLifetime) delete state.online[account];
  }
  for (const [id, invite] of Object.entries(state.invitations)) {
    if (now - invite.at >= inviteLifetime) delete state.invitations[id];
  }
  state.queue = state.queue.filter(player => now - player.seen < membershipLifetime);
  if (state.cancelledMatches?.length) {
    state.cancelledMatches = state.cancelledMatches.filter(match => now - match.at < 2 * membershipLifetime);
  }
  for (const [code, room] of Object.entries(state.rooms)) {
    if (!room.closedAt) {
      pruneWatchers(room, now);
      if (room.waitlist) room.waitlist = room.waitlist.filter(player => now - player.seen < membershipLifetime);
      if (room.previousRound?.expires <= now) delete room.previousRound;
      const stale = room.players.map(player => {
        const hasReplacement = room.waitlist?.some(waiter => waiter.host !== player.id && now - waiter.seen < lifetime);
        return { id: player.id, cutoff: player.seen + (hasReplacement ? lifetime : membershipLifetime) };
      }).filter(player => player.cutoff <= now);
      if (stale.length === 1) departRoom(room, stale[0].id, now, state, stale[0].cutoff);
      else if (stale.length > 1) closeRoom(room, now, state, Math.min(...stale.map(player => player.cutoff)));
      else recordRound(state, room, now);
    }
    if (room.closedAt && now - room.closedAt >= lifetime) delete state.rooms[code];
  }
}

export function locate(state, id) {
  return Object.values(state.rooms).find(room => !room.closedAt && room.players.some(player => player.id === id));
}

function close(state, room, id, now) {
  state.queue = state.queue.filter(player => player.id !== id);
  removeStandby(state, id);
  if (room) departRoom(room, id, now, state);
}

function cancelMatch(state, id, matchId, now) {
  const cancelled = state.cancelledMatches ?? [];
  if (typeof matchId !== 'string' || !validId.test(matchId) || cancelled.some(match => match.id === id && match.matchId === matchId)) return;
  state.cancelledMatches = [...cancelled, { id, matchId, at: now }].slice(-256);
}

function createRoom(state, kind, players, seconds, difficulty) {
  let code;
  do {
    code = Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => alphabet[byte & 31]).join('');
  } while (state.rooms[code]);
  const controller = players.length === 2 ? roomController(players[0].profile, players[1].profile) : null;
  const limits = sharedRoundLimits(players[0].limits, players[1]?.limits);
  const room = { code, kind, players, seconds: fitRoundSeconds(seconds, limits), difficulty, controller, game: null, signals: [], sequence: 0 };
  state.rooms[code] = room;
  return room;
}

function hasRoomSpace(state) {
  return Object.values(state.rooms).filter(room => !room.closedAt).length < maxActiveRooms;
}

function roomLimits(room) {
  return sharedRoundLimits(room.players[0].limits, room.players[1]?.limits);
}

function describe(room, id, after, now, compact) {
  if (!room) return result({ state: 'idle', now });
  const reportPeer = room.players.find(player => player.id !== id && player.account);
  const reportTarget = reportPeer && { target: reportPeer.account, nickname: reportPeer.nickname,
    network: reportPeer.network, room: room.code, context: `${room.code}/${room.game?.id ?? 'waiting'}/${room.partnerRevision ?? 0}` };
  if (room.closedAt) {
    const peer = room.players.find(player => player.id !== id);
    const lastRound = peer?.account && room.game && getProgress(room.game, room.closedAt).done
      ? { code: room.code, round: room.game.id, nickname: peer.nickname, expires: room.closedAt + lifetime } : undefined;
    return { ...result({ state: 'closed', now, lastRound }), reportTarget };
  }
  const game = room.game;
  const me = room.players.findIndex(player => player.id === id);
  const previous = room.previousRound?.expires > now && room.previousRound.players.some(player => player.id === id) && room.previousRound;
  const previousPeer = previous && previous.players.find(player => player.id !== id);
  return { ...result({
    state: 'room',
    now,
    room: {
      code: room.code,
      kind: room.kind,
      seconds: room.seconds,
      limits: roomLimits(room),
      durationRevision: room.durationRevision ?? 0,
      difficulty: room.difficulty,
      controller: room.players.length === 2 ? room.controller ?? 0 : null,
      waitingRole: room.vacancy ? activeRole(room, room.players[0]) : room.players.length === 1 ? normalizeProfile(room.players[0].profile).role : null,
      me,
      players: room.players.map(({ nickname, ready, mic, profile }) => ({
        nickname, ready, mic: room.voice?.status === 'approved' && mic, address: profile?.address || undefined
      })),
      voice: room.voice ?? null,
      voicePreference: room.players.length === 2 ? voiceAgreement(room.players[me]?.profile, room.players[1 - me]?.profile) : null,
      audience: watchMemberView(room, id),
      chat: room.chat,
      standby: room.players.length === 2 || room.vacancy ? {
        open: room.players[me]?.queueOpen === true,
        waiting: room.waitlist?.filter(player => player.host === id).length ?? 0,
        vacant: !!room.vacancy,
        revision: room.partnerRevision ?? 0
      } : null,
      previousRound: previousPeer?.account ? { code: room.code, round: previous.id, nickname: previousPeer.nickname, expires: previous.expires } : undefined,
      game: game && !compact && !game.phases ? { ...game, phases: roundPhases(game) } : game
    },
    signals: room.voice?.status === 'approved'
      ? room.signals.filter(signal => signal.to === id && signal.seq > after).map(({ seq, data }) => ({ seq, data })) : [],
    watchSignals: takeWatchSignals(room, id, after, true)
  }), reportTarget };
}

function startRound(room, now) {
  room.game = {
    id: crypto.randomUUID(), startAt: now + 2_500, seconds: room.seconds, pausedAt: null,
    difficulty: room.difficulty, seed: crypto.getRandomValues(new Uint32Array(1))[0], marks: room.players.map(() => []),
    liveCue: null, cueSequence: 0
  };
  for (const player of room.players) player.ready = false;
}

export function cleanNickname(name) {
  return Array.from(typeof name === 'string' ? name.replace(/\p{C}/gu, '').trim() : '').slice(0, 16).join('');
}

function makePlayer(input, now) {
  return { id: input.id, account: input.account, network: input.network, nickname: cleanNickname(input.nickname), seen: now, ready: false, mic: false,
    profile: normalizeProfile(input.profile), publicGender: Object.hasOwn(genders, input.publicGender) ? input.publicGender : 'unspecified',
    limits: normalizeRoundLimits(input.limits) };
}

function activeRole(room, player) {
  const seat = room.vacancy ? 1 - room.vacancy.index : room.players.indexOf(player);
  return seat === room.controller ? 'controller' : 'receiver';
}

function closeRoom(room, now, state, historyAt = now) {
  recordRound(state, room, historyAt, true);
  room.closedAt = now;
  delete room.waitlist;
  clearVoice(room);
  delete room.watch;
  delete room.chat;
}

function fillVacancy(room, player, now, state) {
  const { host, ...member } = player;
  room.players.splice(room.vacancy.index, 0, { ...member, seen: now });
  delete room.vacancy;
  room.seconds = fitRoundSeconds(room.seconds, roomLimits(room));
  room.waitlist = room.waitlist?.filter(waiter => waiter.id !== member.id) ?? [];
  if (state.historyEvents && room.game) {
    room.game.historyStarted = Math.max(0, getProgress(room.game, now).elapsed);
    room.game.historyMarks = room.game.marks.map(list => list.length);
  }
  for (const seated of room.players) seated.ready = false;
}

function departRoom(room, id, now, state, historyAt = now) {
  const other = room.players.find(player => player.id !== id);
  if (!other?.queueOpen) return closeRoom(room, now, state, historyAt);
  recordRound(state, room, historyAt, true);
  const index = room.players.findIndex(player => player.id === id);
  const game = room.game;
  clearVoice(room);
  delete room.watch;
  delete room.chat;
  if (game && getProgress(game, now).done) {
    const players = room.players.map(({ id, account, nickname }) => ({ id, account, nickname }));
    room.previousRound = { id: game.id, players, expires: now + lifetime };
    room.game = null;
  } else if (game) {
    game.pausedAt ??= Math.max(now, game.resumeAt ?? game.startAt);
    game.marks[index] = [];
    game.liveCue = null;
    for (const field of ['hint', 'reply', 'limit', 'intensity', 'focus', 'extension', 'extensionResult']) delete game[field];
  }
  other.ready = false;
  room.players = [other];
  room.vacancy = { index };
  room.partnerRevision = (room.partnerRevision ?? 0) + 1;
  room.waitlist = (room.waitlist ?? []).filter(player => player.host === other.id && canStandBy(room, other, player, now));
  const next = room.waitlist.find(waiter => now - waiter.seen < lifetime);
  if (next) fillVacancy(room, next, now, state);
}

function standbyRoom(state, id, account) {
  return Object.values(state.rooms).find(room => !room.closedAt && room.waitlist?.some(waiter => waiter.id === id || (account && waiter.account === account)));
}

function removeStandby(state, id) {
  const room = standbyRoom(state, id);
  if (room) room.waitlist = room.waitlist.filter(waiter => waiter.id !== id);
}

function standbySnapshot(room, player, now) {
  const host = room.players.find(member => member.id === player.host);
  const position = room.waitlist.filter(waiter => waiter.host === host.id).indexOf(player) + 1;
  const chat = publicWatch(room) ? { controller: room.controller ?? 0, messages: room.chat?.filter(message => message.public) ?? [] } : undefined;
  return result({ state: 'queued', now, standby: {
    code: room.code, nickname: host.nickname, position,
    role: activeRole(room, host) === 'controller' ? 'receiver' : 'controller', chat
  } });
}

function canStandBy(room, host, player, now) {
  const role = activeRole(room, host);
  const { profile } = player;
  if (profile.role === role) return false;
  if (voiceAgreement(host.profile, profile) === null) return false;
  const limits = sharedRoundLimits(host.limits, player.limits);
  if (!limits || (room.game && !getProgress(room.game, now).done && !withinRoundLimits(room.game.seconds, limits))) return false;
  return room.kind !== 'match' || canMatch({ ...host.profile, role }, profile);
}

function joinStandby(state, input, now, snapshot) {
  const { id, account, target } = input;
  if (input.adult !== true || !account) return problem('请先确认已年满 18 岁并刷新页面。', 403);
  if (typeof target !== 'string' || !guestKeyPattern.test(target) || target === account) return problem('请选择一位开放候补的玩家。');
  const occupied = Object.values(state.rooms).some(room => !room.closedAt && room.players.some(player => player.account === account));
  if (occupied) return problem('请先退出当前对局。', 409);
  if (state.queue.some(player => player.id === id || player.account === account) || standbyRoom(state, id, account)) return queuedElsewhere();
  const room = Object.values(state.rooms).find(room => !room.closedAt && room.players.some(player => player.account === target && player.queueOpen));
  const host = room?.players.find(player => player.account === target);
  if (!host) return problem('对方已关闭候补或离开房间。', 409);
  const player = makePlayer(input, now);
  if (!canStandBy(room, host, player, now)) return problem('你的角色、时长或匹配偏好和这个位置不相符。', 409);
  if (state.online[account]?.id === id) delete state.online[account];
  clearPlayerInvitations(state, account);
  if (room.vacancy) {
    fillVacancy(room, player, now, state);
    return snapshot(room);
  }
  room.waitlist ??= [];
  if (room.waitlist.length >= 24) return problem('候补队列已满。', 409);
  const waiter = { ...player, host: host.id };
  room.waitlist.push(waiter);
  return standbySnapshot(room, waiter, now);
}

function availablePlayer(state, account) {
  const player = state.online?.[account];
  const busy = member => member.id === player.id || member.account === account;
  if (!player || state.queue.some(busy) || standbyRoom(state, player.id, account) || Object.values(state.rooms).some(room => !room.closedAt && room.players.some(busy))) return null;
  return player;
}

function publicPlayer(player) {
  const { voice, address, shareAddress } = normalizeProfile(player.profile);
  return { nickname: player.nickname, role: player.profile.role, gender: player.publicGender ?? 'unspecified',
    ...(voice !== 'any' ? { voicePreference: voice } : {}), ...(shareAddress && address ? { address } : {}),
    limits: normalizeRoundLimits(player.limits) };
}

function onlineCard(player, own) {
  return { ...publicPlayer(player), id: player.account,
    compatible: roomController(own.profile, player.profile) !== null && voiceAgreement(own.profile, player.profile) !== null &&
      !!sharedRoundLimits(own.limits, player.limits) };
}

export function clearPlayerInvitations(state, account) {
  for (const [id, invite] of Object.entries(state.invitations)) {
    if (invite.from === account || invite.to === account) delete state.invitations[id];
  }
}

function socialLobby(state, input, now, snapshot, friends) {
  const { action, account, target } = input;
  if (!account || input.adult !== true) return problem('请先确认已年满 18 岁并刷新页面。', 403);
  const active = locate(state, input.id);
  if (active) return snapshot(active);
  if (state.queue.some(player => player.id === input.id || player.account === account) || standbyRoom(state, input.id, account)) return queuedElsewhere();
  const own = makePlayer(input, now);
  const published = input.visible === true;
  const previous = state.online[account];
  const presenceDelayed = !previous && Object.keys(state.online).length >= 150;
  if (presenceDelayed && action !== 'lobby') return problem('在线列表暂时繁忙，请稍后再试。', 503);
  if (previous?.id !== input.id && previous && locate(state, previous.id)) return problem('此浏览器的另一个页面正在对局。', 409);
  if (!presenceDelayed && (!previous || published !== previous.published || previous.id !== input.id || now - previous.seen >= lobbyTouchEvery ||
    own.nickname !== previous.nickname || own.publicGender !== previous.publicGender || own.network !== previous.network ||
    JSON.stringify(own.profile) !== JSON.stringify(previous.profile) || JSON.stringify(own.limits) !== JSON.stringify(previous.limits))) {
    state.online[account] = { ...own, published };
  }
  const friendIds = new Set(friends.filter(friend => friend.status === 'friend').map(friend => friend.id));
  if (action === 'invite') {
    const peer = availablePlayer(state, target);
    if (target === account || !peer || (!peer.published && !friendIds.has(target))) return problem('对方目前无法接收邀请。', 409);
    if (roomController(own.profile, peer.profile) === null) return problem('对方选了相同角色，请先调整你的角色。', 409);
    if (voiceAgreement(own.profile, peer.profile) === null) return problem('双方的开麦偏好不相符。', 409);
    if (!sharedRoundLimits(own.limits, peer.limits)) return problem('双方可接受的时长没有重叠。', 409);
    if (Object.values(state.invitations).some(invite => invite.from === account)) return problem('上一份邀请仍在等待回应。', 409);
    const id = crypto.randomUUID();
    state.invitations[id] = { id, from: account, to: target, fromTab: input.id, toTab: peer.id, at: now };
  }
  if (action === 'invite-response') {
    const invite = state.invitations[input.invite];
    if (!invite || invite.to !== account || invite.toTab !== input.id || !['accept', 'decline'].includes(input.response)) {
      return problem('邀请已失效。', 409);
    }
    delete state.invitations[invite.id];
    if (input.response === 'accept') {
      const peer = availablePlayer(state, invite.from);
      if (!peer || peer.id !== invite.fromTab) return problem('对方已离开大厅。', 409);
      if (roomController(peer.profile, own.profile) === null) return problem('双方角色相同，请调整角色后重新邀请。', 409);
      if (voiceAgreement(own.profile, peer.profile) === null) return problem('双方的开麦偏好不相符。', 409);
      if (!sharedRoundLimits(peer.limits, own.limits)) return problem('双方可接受的时长没有重叠。', 409);
      if (!hasRoomSpace(state)) return problem('当前房间已满，请稍后再试。', 503);
      clearPlayerInvitations(state, account);
      clearPlayerInvitations(state, invite.from);
      delete state.online[account];
      delete state.online[invite.from];
      return snapshot(createRoom(state, 'friend', [{ ...peer, seen: now }, own], defaultRoundSeconds, 'normal'));
    }
  }
  const directory = Object.keys(state.online).filter(id => id !== account).map(id => availablePlayer(state, id)).filter(Boolean);
  const invitations = Object.values(state.invitations);
  return result({
    state: 'social', now,
    presenceDelayed: presenceDelayed || undefined,
    watchable: input.compact === true ? undefined : watchDirectory(state, now),
    players: directory.filter(peer => peer.published).map(peer => onlineCard(peer, own)),
    standby: Object.values(state.rooms).filter(room => !room.closedAt).flatMap(room => room.players
      .filter(host => host.account && host.account !== account && host.queueOpen)
      .map(host => ({ ...publicPlayer(host), id: host.account, role: activeRole(room, host),
        compatible: canStandBy(room, host, own, now), vacant: !!room.vacancy, waiting: room.waitlist?.filter(waiter => waiter.host === host.id).length ?? 0 }))),
    friends: friends.map(friend => {
      const peer = friend.status === 'friend' && availablePlayer(state, friend.id);
      return { ...friend, online: !!peer, ...(peer && onlineCard(peer, own)) };
    }),
    incoming: invitations.filter(invite => invite.to === account && invite.toTab === input.id).flatMap(invite => {
      const sender = availablePlayer(state, invite.from);
      return sender?.id === invite.fromTab ? [{ ...publicPlayer(sender), id: invite.id }] : [];
    }),
    outgoing: invitations.find(invite => invite.from === account && invite.fromTab === input.id)?.to ?? null
  });
}

function clearVoice(room) {
  room.voice = null;
  room.signals = [];
  for (const player of room.players) player.mic = false;
  clearListening(room);
}

function voiceConsent(room, input, index) {
  const { action, voiceId } = input;
  const voice = room.voice;
  if (room.players.length !== 2) return problem('请等待对方加入。', 409);
  if (action === 'voice-request') {
    if (voice && voice.status !== 'declined') return problem('已有一份房间语音申请。', 409);
    clearVoice(room);
    room.voice = { id: crypto.randomUUID(), requestedBy: index, status: 'pending' };
  } else if (!voice || voice.id !== voiceId) {
    return problem('语音申请已失效。', 409);
  } else if (action === 'voice-close') {
    clearVoice(room);
  } else {
    if (voice.requestedBy === index) return problem('需要对方同意才能开启语音。', 403);
    if (voice.status !== 'pending' || !['accept', 'decline'].includes(input.response)) return problem('语音申请已处理。', 409);
    voice.status = input.response === 'accept' ? 'approved' : 'declined';
    if (voice.status === 'approved') updatePublicListeners(room);
  }
}

function canMatch(first, second) {
  const a = normalizeProfile(first);
  const b = normalizeProfile(second);
  const aTarget = desiredGender(a);
  const bTarget = desiredGender(b);
  return roomController(a, b) !== null &&
    voiceAgreement(a, b) !== null &&
    (aTarget === 'any' || aTarget === b.gender) &&
    (bTarget === 'any' || bTarget === a.gender);
}

function pairWaitingPlayer(state, player, now) {
  if (!hasRoomSpace(state)) return;
  const peer = state.queue.find(other => other.id !== player.id && (!player.account || other.account !== player.account) &&
    now - other.seen < lifetime && canMatch(player.profile, other.profile) && sharedRoundLimits(player.limits, other.limits));
  if (!peer) return;
  state.queue = state.queue.filter(other => other.id !== peer.id && other.id !== player.id);
  return createRoom(state, 'match', [peer, player], defaultRoundSeconds, 'normal');
}

function setManualCue(game, progress, cue) {
  game.cueSequence = (game.cueSequence ?? 0) + 1;
  game.liveCue = { id: `cue-${game.cueSequence}`, since: progress.elapsed, ...cue };
}

function pauseRound(room, now) {
  room.game.pausedAt = now;
  for (const member of room.players) member.ready = false;
}

function roundInteraction(room, input, index, now, progress, running) {
  const game = room.game;
  const { kind, value } = input;
  const isController = index === (room.controller ?? 0);
  if (!game || game.id !== input.round || progress.done || now < (game.resumeAt ?? game.startAt)) {
    return problem('当前没有可操作的对局。', 409);
  }
  if (kind === 'finish') {
    game.finishedAt = game.pausedAt ?? now;
    game.pausedAt = null;
    delete game.extension;
    for (const member of room.players) member.ready = false;
    return;
  }
  if (room.players.length !== 2) return problem('请等待新的搭档加入。', 409);
  if (!running && !(kind === 'reply' && game.pausedAt != null)) return problem('对局暂停中。', 409);
  if (['tempo', 'tempo-adjust', 'stop-for', 'intensity', 'intensity-adjust', 'focus', 'hint', 'custom-hint', 'extend'].includes(kind) && !isController) {
    return problem('这一项由领拍者操作。', 403);
  }
  if (['reply', 'limit', 'extension-response'].includes(kind) && isController) {
    return problem('这一项由跟拍者操作。', 403);
  }
  switch (kind) {
    case 'tempo':
      if (!Number.isInteger(value) || !Object.hasOwn(tempos, value)) return problem('请选择有效的节拍。');
      setManualCue(game, progress, { kind: value < 75 ? 'slow' : 'fast', bpm: value });
      return;
    case 'tempo-adjust': {
      if (!['slower', 'hold', 'faster'].includes(value)) return problem('请选择有效的节拍操作。');
      const current = progress.phase?.bpm ?? cues[progress.phase?.kind]?.bpm;
      const levels = Object.keys(tempos).map(Number);
      const index = levels.indexOf(current);
      if (index < 0) return problem('停拍中可选择具体节拍恢复。', 409);
      const next = levels[index + ({ slower: -1, hold: 0, faster: 1 })[value]];
      if (next) setManualCue(game, progress, { kind: next < 75 ? 'slow' : 'fast', bpm: next });
      return;
    }
    case 'stop-for': {
      if (!shortStops.includes(value)) return problem('请选择有效的停拍时长。');
      const until = progress.elapsed + value * 1000;
      const previous = progress.live?.kind === 'stop' ? progress.live.resume : progress.live;
      const resume = previous ? { ...previous, since: until } : null;
      setManualCue(game, progress, { kind: 'stop', until, resume });
      return;
    }
    case 'intensity-adjust': {
      if (!['lighter', 'heavier'].includes(value)) return problem('请选择有效的强度操作。');
      const direction = value === 'lighter' ? -1 : 1;
      const next = Math.max(0, Math.min(roomLimits(room).maxIntensity, (game.intensity ?? 0) + direction));
      if (next) game.intensity = next;
      else delete game.intensity;
      return;
    }
    case 'intensity':
      if (!Number.isInteger(value) || value < 0 || value > maxIntensity) return problem('请选择有效的强度档位。');
      if (value > roomLimits(room).maxIntensity) return problem('超过了双方接受的强度上限。', 409);
      if (value) game.intensity = value;
      else delete game.intensity;
      return;
    case 'focus':
      if (typeof value !== 'string' || !Object.hasOwn(focusOptions, value)) return problem('请选择有效的动作焦点。');
      game.focus = value;
      return;
    case 'hint':
      if (typeof value !== 'string' || !Object.hasOwn(coachHints, value)) return problem('请选择预设提示。');
      game.hint = { key: value, at: now };
      return;
    case 'custom-hint': {
      const text = cleanCustomHint(value);
      if (!text || text.length > customHintLimit) return problem(`请填写 1–${customHintLimit} 字的指令。`);
      game.hint = { text, at: now };
      return;
    }
    case 'reply':
      if (typeof value !== 'string' || !Object.hasOwn(receiverReplies, value)) return problem('请选择预设回馈。');
      game.reply = { key: value, at: now };
      if (running && ['rest', 'uncomfortable', 'boundary'].includes(value)) pauseRound(room, now);
      return;
    case 'limit':
      if (!Number.isInteger(value) || value < 0 || value > 5) return problem('请选择有效的极限档位。');
      if (value) game.limit = value;
      else delete game.limit;
      return;
    case 'extend':
      if (!extensions.includes(value)) return problem('请选择可用的加时时长。');
      if (!withinRoundLimits(game.seconds + value, roomLimits(room))) return problem('加时会超过双方接受的时长上限。', 409);
      if (game.extension) return problem('对方还未处理上一个加时提议。', 409);
      game.extension = { id: crypto.randomUUID(), seconds: value };
      return;
    case 'extension-response':
      if (!game.extension || input.request !== game.extension.id || !['accept', 'decline'].includes(value)) {
        return problem('该加时提议已失效。', 409);
      }
      if (value === 'accept') {
        const extra = game.extension.seconds;
        if (game.phases) {
          const previousEnd = game.seconds * 1000;
          game.phases.push(...plan(extra, room.difficulty).map(phase => ({ ...phase, end: previousEnd + phase.end })));
        }
        game.seconds += extra;
      }
      game.extensionResult = { accepted: value === 'accept', seconds: game.extension.seconds, at: now };
      delete game.extension;
      return;
    default:
      return problem('对局操作无效。');
  }
}

function update(state, input, now, friends) {
  const { id, action, account } = input;
  const after = Number.isSafeInteger(input.after) && input.after >= 0 ? input.after : 0;
  const snapshot = room => describe(room, id, after, now, input.compact === true);
  if (watcherActions.includes(action)) {
    state.online ??= {};
    state.invitations ??= {};
    return watcherAction(state, input, now);
  }
  sweep(state, now);
  const active = locate(state, id);
  const waitingRoom = standbyRoom(state, id);
  const standby = waitingRoom?.waitlist.find(player => player.id === id);
  const existingPlayer = active?.players.find(player => player.id === id) ?? state.queue.find(player => player.id === id) ?? standby;
  if (existingPlayer?.account && existingPlayer.account !== account) return problem('身份已变更，请刷新页面。', 403);
  if (existingPlayer && account && !existingPlayer.account) existingPlayer.account = account;
  if (existingPlayer && input.network) existingPlayer.network = input.network;
  if (lobbyActions.includes(action)) return socialLobby(state, input, now, snapshot, friends);
  if (action === 'lobby-away' && account && state.online[account]?.id === id) {
    delete state.online[account];
    clearPlayerInvitations(state, account);
    return result({ state: 'idle', now });
  }
  if (action === 'leave') {
    if (account) cancelMatch(state, id, input.matchId, now);
    const differentMatch = input.matchId && existingPlayer?.matchId && input.matchId !== existingPlayer.matchId;
    const differentRoom = input.code && active && input.code !== active.code;
    if (!differentMatch && !differentRoom) close(state, active, id, now);
    return result({ state: 'idle', now });
  }
  if (action === 'clear-queue') {
    if (!account || input.adult !== true) return problem('请先确认已年满 18 岁。', 403);
    for (const player of state.queue) {
      if (player.account === account) cancelMatch(state, player.id, player.matchId, now);
    }
    state.queue = state.queue.filter(player => player.account !== account);
    for (const room of Object.values(state.rooms)) {
      if (room.waitlist) room.waitlist = room.waitlist.filter(player => player.account !== account);
    }
    return result({ state: 'queue-cleared', now });
  }
  if (action === 'standby-join') {
    if (input.adult !== true || !account) return problem('请先确认已年满 18 岁。', 403);
    if (active?.players.some(member => member.account === input.target)) return snapshot(active);
    if (standby && waitingRoom.players.some(host => host.id === standby.host && host.account === input.target)) {
      standby.seen = now;
      return standbySnapshot(waitingRoom, standby, now);
    }
    return joinStandby(state, input, now, snapshot);
  }
  if (action === 'match' || action === 'create' || action === 'join') {
    if (input.adult !== true) return problem('请先确认已年满 18 岁。', 403);
    const matchId = action === 'match' && typeof input.matchId === 'string' && validId.test(input.matchId) ? input.matchId : undefined;
    if (matchId && state.cancelledMatches?.some(match => match.id === id && match.matchId === matchId)) {
      return problem('本次匹配已取消。', 409);
    }
    if (active) return snapshot(active);
    if (account && Object.values(state.rooms).some(room => !room.closedAt && room.players.some(player => player.account === account))) {
      return problem('此身份已在另一个页面的对局中。', 409);
    }
    if (account && (state.queue.some(player => player.id !== id && player.account === account) || (standbyRoom(state, id, account) && !standby))) {
      return queuedElsewhere();
    }
    const pending = state.queue.find(player => player.id === id);
    if (action === 'match' && pending) {
      if (matchId) pending.matchId = matchId;
      if (input.profile) pending.profile = normalizeProfile(input.profile);
      if (input.limits) pending.limits = normalizeRoundLimits(input.limits);
      if (now - pending.seen >= touchEvery) pending.seen = now;
      const paired = pairWaitingPlayer(state, pending, now);
      return paired ? snapshot(paired) : result({ state: 'queued', now });
    }
    state.queue = state.queue.filter(player => player.id !== id);
    removeStandby(state, id);
    const player = makePlayer(input, now);
    if (matchId) player.matchId = matchId;
    if (account && state.online[account]?.id === id) {
      delete state.online[account];
      clearPlayerInvitations(state, account);
    }
    if (action === 'join') {
      const invited = validRoomCode.test(input.code) ? state.rooms[input.code] : null;
      if (!invited || invited.kind !== 'friend' || invited.closedAt) return problem('找不到这个房间，请核对房间码。', 404);
      if (invited.players.length !== 1) return problem('房间已有两位玩家。', 409);
      if (account && invited.players[0].account === account) return problem('请由另一位玩家加入此房间。', 409);
      if (invited.vacancy) {
        if (!canStandBy(invited, invited.players[0], player, now)) return problem('你的角色或时长与当前对局不符。', 409);
        fillVacancy(invited, player, now, state);
        return snapshot(invited);
      }
      const controller = roomController(invited.players[0].profile, player.profile);
      if (controller === null) return problem('对方也选了这个角色。请选择另一角色或「都可以」。', 409);
      const limits = sharedRoundLimits(invited.players[0].limits, player.limits);
      if (!limits) return problem('双方可接受的时长没有重叠。', 409);
      const seconds = fitRoundSeconds(invited.seconds, limits);
      if (seconds !== invited.seconds) invited.durationRevision = (invited.durationRevision ?? 0) + 1;
      invited.seconds = seconds;
      invited.controller = controller;
      invited.players.push(player);
      return snapshot(invited);
    }
    if (action === 'create') {
      if (!hasRoomSpace(state)) return problem('当前房间已满，请稍后再试。', 503);
      if (input.seconds !== undefined && !validRoundSeconds(input.seconds)) return problem('时长须为 1–120 分钟的整数。');
      if (input.seconds !== undefined && !withinRoundLimits(input.seconds, player.limits)) return problem('请选择你可接受范围内的时长。');
      const seconds = input.seconds ?? defaultRoundSeconds;
      const difficulty = Object.hasOwn(paces, input.difficulty) ? input.difficulty : 'normal';
      return snapshot(createRoom(state, 'friend', [player], seconds, difficulty));
    }
    const paired = pairWaitingPlayer(state, player, now);
    if (paired) return snapshot(paired);
    if (state.queue.length >= maxWaitingPlayers) {
      const disconnected = state.queue.findIndex(other => now - other.seen >= lifetime);
      if (disconnected < 0) return result({ error: '随机匹配队列已满，正在等候空位。', code: 'queue-full' }, 503);
      state.queue.splice(disconnected, 1);
    }
    state.queue.push(player);
    return result({ state: 'queued', now });
  }

  const addressed = validRoomCode.test(input.code) ? state.rooms[input.code] : null;
  if (action === 'room-chat' && (!account || !addressed?.players.some(player => player.id === id && player.account === account))) {
    return problem('只有当前房间的玩家可以发送消息。', 403);
  }
  if (input.code && (!addressed || !addressed.players.some(player => player.id === id))) {
    return result({ state: 'closed', now });
  }
  const room = addressed ?? active;
  if (!room) {
    if (standby) {
      if (waitingRoom.vacancy && canStandBy(waitingRoom, waitingRoom.players[0], standby, now)) {
        fillVacancy(waitingRoom, standby, now, state);
        return snapshot(waitingRoom);
      }
      if (now - standby.seen >= touchEvery) standby.seen = now;
      return standbySnapshot(waitingRoom, standby, now);
    }
    const waiting = state.queue.find(player => player.id === id);
    if (!waiting) return result({ state: 'idle', now });
    if (now - waiting.seen >= touchEvery) {
      waiting.seen = now;
      const paired = pairWaitingPlayer(state, waiting, now);
      if (paired) return snapshot(paired);
    }
    return result({ state: 'queued', now });
  }
  if (room.players.some(player => player.id === id && player.account && player.account !== account)) return problem('身份已变更，请刷新页面。', 403);
  if (room.closedAt) return snapshot(room);
  const index = room.players.findIndex(player => player.id === id);
  const player = room.players[index];
  if (now - player.seen >= touchEvery) player.seen = now;
  if (after > 0 && room.signals.some(signal => signal.to === id && signal.seq <= after)) {
    room.signals = room.signals.filter(signal => signal.to !== id || signal.seq > after);
  }

  if (action === 'room-chat') {
    if (room.players.length !== 2 || input.partnerRevision !== (room.partnerRevision ?? 0)) {
      return problem('需要两位玩家在同一房间才能发送消息。', 409);
    }
    const message = typeof input.message === 'string'
      ? input.message.replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, '').trim() : '';
    if (!message || message.length > 200 || typeof input.messageId !== 'string' || !validId.test(input.messageId)) {
      return problem('请输入 1–200 字的消息。');
    }
    const chat = room.chat ?? [];
    const prior = chat.find(entry => entry.id === input.messageId);
    if (prior) return prior.seat === index && prior.message === message ? snapshot(room) : problem('无法重用此消息编号。', 409);
    if (now - (chat.findLast(entry => entry.seat === index)?.at ?? -Infinity) < 700) {
      return problem('消息发送太快，请稍后再试。', 429);
    }
    room.chat = [...chat, { id: input.messageId, seat: index, message, at: now, public: input.public === true && publicWatch(room) }].slice(-24);
    return snapshot(room);
  }

  const game = room.game;
  const phases = game && roundPhases(game);
  const progress = getProgress(game, now, phases);
  const betweenRounds = !game || progress.done;
  if (action === 'standby-open') {
    if (!account || (room.players.length !== 2 && !room.vacancy)) return problem('双人房到齐后可开放候补。', 409);
    player.queueOpen = input.open === true;
    if (!player.queueOpen && room.waitlist) room.waitlist = room.waitlist.filter(waiter => waiter.host !== id);
  }
  if (watchRoomActions.includes(action)) {
    const error = memberWatchAction(room, input, index);
    return error ?? snapshot(room);
  }
  if (action === 'duration') {
    if (!betweenRounds) return problem('本局已开始，可以在下一局开始前调整时长。', 409);
    if (!validRoundSeconds(input.seconds)) return problem('时长须为 1–120 分钟的整数。');
    if (!withinRoundLimits(input.seconds, roomLimits(room))) return problem('请选择双方可接受范围内的时长。', 409);
    if (input.seconds !== room.seconds) {
      room.seconds = input.seconds;
      room.durationRevision = (room.durationRevision ?? 0) + 1;
      for (const member of room.players) member.ready = false;
    }
  }
  if (action === 'ready' && room.players.length === 2 && (betweenRounds || game.pausedAt)) {
    if (input.ready === true && (input.partnerRevision ?? 0) !== (room.partnerRevision ?? 0)) {
      return problem('搭档已更换，请确认后重新准备。', 409);
    }
    if (betweenRounds && input.ready === true && (input.durationRevision ?? 0) !== (room.durationRevision ?? 0)) {
      return problem('本局时长已更新，请确认新时长后再准备。', 409);
    }
    if (input.ready === true && typeof input.watchOpen === 'boolean') setWatchOpen(room, id, input.watchOpen, input.shareDetails === true);
    player.ready = input.ready === true;
    if (room.players.every(member => member.ready)) {
      if (game?.pausedAt) {
        game.startAt += now + 2_500 - game.pausedAt;
        game.pausedAt = null;
        game.resumeAt = now + 2_500;
        for (const member of room.players) member.ready = false;
      } else {
        recordRound(state, room, now, true);
        startRound(room, now);
      }
    }
  }
  const running = game && !progress.done && !game.pausedAt && now >= (game.resumeAt ?? game.startAt);
  if (action === 'pause' && running) pauseRound(room, now);
  if (action === 'interaction') {
    const error = roundInteraction(room, input, index, now, progress, running);
    if (error) return error;
    if (input.kind === 'finish') recordRound(state, room, now, true);
  }
  if (action === 'cue') {
    if (index !== (room.controller ?? 0)) return problem('只有领拍者可以发送节奏指令。', 403);
    if (!running || game.id !== input.round) return problem('对局还未开始或已经暂停。', 409);
    if (input.cue === 'auto') game.liveCue = null;
    else if (typeof input.cue === 'string' && Object.hasOwn(cues, input.cue)) {
      if (progress.live?.kind !== input.cue || progress.live?.until != null || progress.live?.bpm != null) {
        setManualCue(game, progress, { kind: input.cue });
      }
    } else return problem('节奏指令无效。');
  }
  if (action === 'mark' && game?.id === input.round && progress && game.finishedAt == null && !game.pausedAt && now >= (game.resumeAt ?? game.startAt)) {
    const phase = phases[input.index];
    const phaseStart = phases[input.index - 1]?.end ?? 0;
    const elapsed = now - game.startAt;
    const manualStop = running && index !== (room.controller ?? 0) && progress.live?.kind === 'stop' && progress.live.id === input.index;
    const timedStop = !progress.live && Number.isInteger(input.index) && phase?.kind === 'stop' &&
      elapsed >= phaseStart && elapsed <= phase.end + 800;
    if ((manualStop || timedStop) && !game.marks[index].includes(input.index)) game.marks[index].push(input.index);
  }
  if (['voice-request', 'voice-response', 'voice-close'].includes(action)) {
    const error = voiceConsent(room, input, index);
    if (error) return error;
  }
  if (action === 'voice-config') {
    if (!account || room.voice?.status !== 'approved' || room.voice.id !== input.voiceId) return problem('语音需双方同意后才能使用。', 403);
    return result({ state: 'ice', now });
  }
  if (relayActions.includes(action)) return relayRoomAction(room, input, index) ?? snapshot(room);
  if (['mic', 'signal'].includes(action) && (room.voice?.status !== 'approved' || room.voice.id !== input.voiceId)) {
    return problem('语音需双方同意后才能使用。', 403);
  }
  if (action === 'mic') {
    if (input.on === true && !player.mic) (room.voice.relayMicSince ??= [null, null])[index] = now;
    player.mic = input.on === true;
  }
  if (action === 'signal') {
    const data = input.data;
    const description = data?.description;
    const candidate = data?.candidate;
    const valid = (['offer', 'answer'].includes(description?.type) && typeof description.sdp === 'string' && description.sdp.length <= 9_000)
      || (candidate && typeof candidate.candidate === 'string' && candidate.candidate.length <= 2_000)
      || (index === 1 && data?.restart === true);
    if (!valid || JSON.stringify(data).length > 10_000) return problem('语音连接信息无效。');
    const peer = room.players[1 - index];
    room.signals.push({ seq: ++room.sequence, to: peer.id, data });
    room.signals = room.signals.slice(-32);
  }
  return snapshot(room);
}

export function memoryStore(history) {
  const state = empty();
  if (history) Object.defineProperty(state, 'historyEvents', { value: [] });
  const relay = memoryRelay(() => state, lifetime);
  return {
    relay,
    history,
    change(apply) {
      const next = apply(state);
      if (state.historyEvents?.length) history.save(state.historyEvents.splice(0));
      relay.prune(Date.now());
      return next;
    }
  };
}

function roomMembership(room) {
  return JSON.stringify([room.closedAt, room.players.map(({ id, account }) => [id, account]),
    room.waitlist?.map(({ id, account }) => [id, account]), room.watch?.viewers.map(({ id }) => id)]);
}

function onlineIdentity({ seen, ...identity }) {
  return JSON.stringify(identity);
}

function mapUpdates(previous = {}, current = {}) {
  const edits = {};
  const guards = {};
  for (const key of new Set([...Object.keys(previous), ...Object.keys(current)])) {
    const before = previous[key] && JSON.stringify(previous[key]);
    if (JSON.stringify(current[key]) === before) continue;
    edits[key] = current[key] ?? null;
    guards[key] = before ?? null;
  }
  return { edits, guards, keys: Object.keys(edits) };
}

function mergeLobbyMap(field, param) {
  return `(
    SELECT json_group_object(key, json(value)) FROM (
      SELECT saved.key, saved.value FROM json_each(lobby_state.payload, '$.${field}') AS saved
      WHERE NOT EXISTS (SELECT 1 FROM json_each(${param}) AS edited WHERE edited.key = saved.key)
      UNION ALL
      SELECT edited.key, edited.value FROM json_each(${param}) AS edited WHERE edited.type = 'object'
    )
  )`;
}

function jsonEntries(value) {
  return `SELECT fullkey, CASE WHEN type IN ('integer', 'real') THEN 'number' ELSE type END, atom FROM json_tree(${value})`;
}

const savedRoom = "json_extract(lobby_state.payload, '$.rooms.' || previous.key)";
const patchLobby = `UPDATE lobby_state
  SET revision = revision + 1,
      payload = json_set(?1, '$.rooms', json(${mergeLobbyMap('rooms', '?2')}), '$.online', json(${mergeLobbyMap('online', '?5')}))
  WHERE id = 1 AND revision = ?3 AND NOT EXISTS (
    SELECT 1 FROM json_each(?4) AS previous
    WHERE ${savedRoom} IS NOT previous.value AND (
      EXISTS (${jsonEntries(savedRoom)} EXCEPT ${jsonEntries('previous.value')}) OR
      EXISTS (${jsonEntries('previous.value')} EXCEPT ${jsonEntries(savedRoom)})
    )
  ) AND NOT EXISTS (
    SELECT 1 FROM json_each(?6) AS previous
    WHERE json_extract(lobby_state.payload, '$.online."' || previous.key || '"') IS NOT previous.value
  )`;

const watchFields = ['closedAt', 'watch.key', 'watch.openBy', 'watch.audioBy', 'watch.viewers', 'voice.id', 'voice.status',
  'players[0].id', 'players[0].account', 'players[1].id', 'players[1].account'];
const unchangedWatchFields = watchFields.map(field => `json_extract(payload, ?1 || '.${field}') IS json_extract(?2, '$.${field}')`).join(' AND ');

function replaceViewers(payload) {
  return `CASE WHEN json_type(payload, ?1 || '.watch') = 'object'
    THEN json_set(${payload}, ?1 || '.watch.viewers', json_extract(?3, '$.viewers'))
    ELSE json_set(${payload}, ?1 || '.watch', json(?3)) END`;
}

const watcherLobby = `json_set(
      CASE WHEN json_extract(payload, '$.online."' || ?5 || '".id') = ?4
        THEN json_remove(payload, '$.online."' || ?5 || '"') ELSE payload END,
      '$.invitations', json((SELECT json_group_object(key, json(value)) FROM json_each(lobby_state.payload, '$.invitations')
        WHERE json_extract(value, '$.from') IS NOT ?5 AND json_extract(value, '$.to') IS NOT ?5))
    )`;

function viewerIsNotPlaying(id, cutoff) {
  return `NOT EXISTS (
    SELECT 1 FROM json_each(lobby_state.payload, '$.rooms') AS other, json_each(other.value, '$.players') AS player
    WHERE json_extract(other.value, '$.closedAt') IS NULL
      AND json_extract(player.value, '$.id') = ${id} AND json_extract(player.value, '$.seen') > ${cutoff}
  )`;
}

const admitWatcher = `UPDATE lobby_state
  SET revision = revision + 1, payload = ${replaceViewers(watcherLobby)}
  WHERE id = 1 AND ${unchangedWatchFields} AND ${viewerIsNotPlaying('?4', '?6')} AND NOT EXISTS (
    SELECT 1 FROM json_each(lobby_state.payload, '$.rooms') AS other, json_each(other.value, '$.watch.viewers') AS viewer
    WHERE '$.rooms.' || other.key <> ?1 AND json_extract(other.value, '$.closedAt') IS NULL
      AND json_extract(viewer.value, '$.id') = ?4 AND json_extract(viewer.value, '$.seen') > ?7
  )`;

const saveViewers = `UPDATE lobby_state
  SET revision = revision + ?4, payload = ${replaceViewers('payload')}
  WHERE id = 1 AND ${unchangedWatchFields} AND ${viewerIsNotPlaying('?5', '?6')}`;

const releaseViewer = `UPDATE lobby_state
  SET revision = revision + 1, payload = json_set(${replaceViewers('payload')}, ?1 || '.watch.signals', (
    SELECT json_group_array(json(signal.value)) FROM json_each(payload, ?1 || '.watch.signals') AS signal
    WHERE json_extract(signal.value, '$.viewer') IS NOT ?4
  ))
  WHERE id = 1 AND ${unchangedWatchFields}`;

const saveViewerSignals = `UPDATE lobby_state
  SET revision = revision + ?7,
      payload = json_set(${replaceViewers('payload')}, ?1 || '.watch.signals', json_extract(?3, '$.signals'), ?1 || '.sequence', CAST(?4 AS INTEGER))
  WHERE id = 1 AND ${unchangedWatchFields} AND ${viewerIsNotPlaying('?5', '?6')}
    AND json_extract(payload, ?1 || '.watch.signals') IS json_extract(?2, '$.watch.signals')
    AND json_extract(payload, ?1 || '.sequence') IS json_extract(?2, '$.sequence')`;

async function writeWatcherUpdate(db, previous, state, next, input) {
  const action = input?.action;
  if (!watcherActions.includes(action)) return;
  if (typeof input.key !== 'string') return;
  const room = Object.values(state.rooms).find(candidate => candidate.watch?.key === input.key);
  const oldRoom = room && previous.rooms[room.code];
  if (!oldRoom || !room.watch || roomMembership(room) !== roomMembership({ ...oldRoom, watch: room.watch })) return;
  const isViewer = member => member.id === input.id && member.account === input.account;
  const viewer = room.watch?.viewers.find(isViewer);
  const path = `$.rooms.${room.code}`;
  const fields = [path, JSON.stringify(oldRoom), JSON.stringify(room.watch)];
  const now = next.value.now;
  const cutoff = now - membershipLifetime;
  if (action === 'watch-join' && next.value.state === 'watching' && viewer) {
    // Admission guards the seats and consent, and preserves the latest game and signals.
    return db.prepare(admitWatcher).bind(...fields, input.id, input.account, cutoff, now - lifetime).run();
  }
  const membershipChanged = roomMembership(room) !== roomMembership(oldRoom) ? 1 : 0;
  if (action === 'watch-receive' && next.value.state === 'watching') {
    return db.prepare(saveViewerSignals).bind(...fields, room.sequence, input.id, cutoff, membershipChanged).run();
  }
  if ((action === 'watch-sync' || action === 'watch-listen') && next.value.state === 'watching') {
    return db.prepare(saveViewers).bind(...fields, membershipChanged, input.id, cutoff).run();
  }
  if (action === 'watch-leave' && next.value.state === 'watch-closed' && oldRoom.watch?.viewers.some(isViewer) && !viewer) {
    return db.prepare(releaseViewer).bind(...fields, input.id).run();
  }
}

export function databaseStore(db, history) {
  return {
    relay: databaseRelay(db, lifetime),
    history,
    async freshMatch(input, now) {
      const queued = await db.prepare(`SELECT 1 AS queued FROM lobby_state, json_each(payload, '$.queue')
        WHERE lobby_state.id = 1 AND json_extract(value, '$.id') = ?1 AND json_extract(value, '$.account') = ?2
        AND json_extract(value, '$.matchId') = ?3 AND json_extract(value, '$.seen') > ?4
        LIMIT 1`).bind(input.id, input.account, input.matchId, now - touchEvery).first();
      return !!queued;
    },
    async change(apply, roomCode, input) {
      const operation = input?.action;
      const path = roomCode && `$.rooms.${roomCode}`;
      const trackPresence = operation === 'lobby' || operation === 'sync' || watcherActions.includes(operation);
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const row = path
          ? await db.prepare('SELECT json_extract(payload, ?) AS payload FROM lobby_state WHERE id = 1').bind(path).first()
          : await db.prepare('SELECT revision, payload FROM lobby_state WHERE id = 1').first();
        if (!row) throw new Error('大厅尚未初始化');
        const original = JSON.parse(row.payload);
        const state = path ? { rooms: original ? { [roomCode]: original } : {}, queue: [] } : original;
        if (history) Object.defineProperty(state, 'historyEvents', { value: [] });
        const membership = path && original && roomMembership(original);
        const beforeLobby = !path && trackPresence && JSON.stringify({ ...state, rooms: {}, online: {} });
        const next = apply(state);
        const events = state.historyEvents;
        const writeStatement = statement => events?.length
          ? db.batch([statement, history.write(events)]).then(results => results[0]) : statement.run();
        if (operation === 'watch-config') return next;
        const payload = path ? state.rooms[roomCode] && JSON.stringify(state.rooms[roomCode]) : JSON.stringify(state);
        if (!payload || payload === row.payload) return next;
        if (payload.length > 1_300_000) {
          if (operation === 'lobby' && next.value.state === 'social') return result({ ...next.value, presenceDelayed: true });
          console.warn('Lobby state exceeded the write limit');
          return problem('大厅暂时繁忙，请稍后再试。', 503);
        }
        let write;
        if (path) {
          const revisionChange = membership === roomMembership(state.rooms[roomCode]) ? 0 : 1;
          write = await writeStatement(db.prepare('UPDATE lobby_state SET revision = revision + ?4, payload = json_set(payload, ?1, json(?2)) WHERE id = 1 AND json_extract(payload, ?1) = ?3')
            .bind(path, payload, row.payload, revisionChange));
        } else {
          // Rebase on untouched rooms and presence records so a structural change
          // keeps heartbeats that committed after its original snapshot.
          const previous = JSON.parse(row.payload);
          if (!events?.length && attempt < 8) write = await writeWatcherUpdate(db, previous, state, next, input);
          if (!write) {
            const rooms = mapUpdates(previous.rooms, state.rooms);
            const online = mapUpdates(previous.online, state.online);
            const lobby = JSON.stringify({ ...state, rooms: {}, online: {} });
            const code = rooms.keys[0];
            const account = online.keys[0];
            let quietPath;
            let quietBefore;
            let quietAfter;
            if (beforeLobby === lobby && rooms.keys.length === 1 && !online.keys.length && rooms.guards[code] && rooms.edits[code] &&
              roomMembership(JSON.parse(rooms.guards[code])) === roomMembership(rooms.edits[code])) {
              quietPath = `$.rooms.${code}`;
              quietBefore = rooms.guards[code];
              quietAfter = rooms.edits[code];
            } else if (operation === 'lobby' && beforeLobby === lobby && !rooms.keys.length && online.keys.length === 1 &&
              online.guards[account] && online.edits[account] &&
              onlineIdentity(JSON.parse(online.guards[account])) === onlineIdentity(online.edits[account])) {
              quietPath = `$.online."${account}"`;
              quietBefore = online.guards[account];
              quietAfter = online.edits[account];
            }
            if (quietPath) {
              write = await writeStatement(db.prepare('UPDATE lobby_state SET payload = json_set(payload, ?1, json(?2)) WHERE id = 1 AND json_extract(payload, ?1) = ?3 AND revision = ?4')
                .bind(quietPath, JSON.stringify(quietAfter), quietBefore, row.revision));
            } else {
              write = await writeStatement(db.prepare(patchLobby).bind(lobby, JSON.stringify(rooms.edits), row.revision, JSON.stringify(rooms.guards),
                JSON.stringify(online.edits), JSON.stringify(online.guards)));
            }
          }
        }
        // D1 also counts relay packets removed by the lobby update trigger.
        if (write.meta.changes > 0) return next;
        if (operation === 'lobby' && next.value.state === 'social') return result({ ...next.value, presenceDelayed: true });
        const jitter = Math.random() * Math.min(20 * 2 ** attempt, 150);
        if (attempt < 11) await new Promise(resolve => setTimeout(resolve, jitter));
      }
      console.warn(path ? 'Room write conflicted repeatedly' : 'Lobby write conflicted repeatedly', { operation });
      return problem('大厅暂时繁忙，请稍后再试。', 503);
    }
  };
}

export function iceServers(settings = {}) {
  const servers = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
  if (settings.TURN_URL && settings.TURN_USERNAME && settings.TURN_CREDENTIAL) {
    servers.push({ urls: settings.TURN_URL.split(',').map(url => url.trim()).filter(Boolean), username: settings.TURN_USERNAME, credential: settings.TURN_CREDENTIAL });
  }
  return servers;
}

async function authorizedIceServers(settings) {
  const servers = iceServers(settings);
  if (!settings.TURN_KEY_ID || !settings.TURN_KEY_API_TOKEN) return servers;
  try {
    const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(settings.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${settings.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 14_400 })
    });
    if (!response.ok) return servers;
    const { iceServers: relay } = await response.json();
    return [...servers, ...relay.flatMap(server => {
      const urls = [server.urls].flat().filter(url => typeof url === 'string' && /^turns?:/.test(url) && !/:53(?:\?|$)/.test(url));
      return urls.length ? [{ urls, username: server.username, credential: server.credential }] : [];
    })];
  } catch {
    return servers;
  }
}

const lobbyActions = ['lobby', 'invite', 'invite-response'];
const friendActions = ['friend-add', 'history-friend-add', 'friend-response', 'friend-chat', 'friend-message'];
const roomActions = ['sync', 'duration', 'ready', 'pause', 'mark', 'cue', 'interaction', 'room-chat', 'mic', 'signal',
  'voice-request', 'voice-response', 'voice-close', 'voice-config', 'standby-open', ...watchRoomActions, ...relayActions];
const actions = new Set([...roomActions, 'match', 'create', 'join', 'leave', 'clear-queue', 'standby-join', 'lobby-away', 'report-player', 'history', 'friend-presence', ...lobbyActions, ...friendActions, ...watcherActions]);
const localFriends = memoryFriends();

async function changeFriend(store, friends, input, now) {
  const { action, account, target, response, code, round } = input;
  if (!account || input.adult !== true) return problem('请先确认已年满 18 岁并刷新页面。', 403);
  if (action === 'friend-chat' || action === 'friend-message') {
    if (typeof target !== 'string' || !guestKeyPattern.test(target) || target === account) return problem('请选择一位好友。');
    if (action === 'friend-chat') {
      const { before } = input;
      if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) return problem('消息页码无效。');
      const thread = await friends.thread(account, target, before, now);
      return thread ? result({ state: 'friend-chat', ...thread }) : problem('双方成为好友后才可以私信。', 403);
    }
    const { messageId } = input;
    const text = typeof input.message === 'string' ? input.message.trim() : '';
    if (!text || text.length > 500 || typeof messageId !== 'string' || !validId.test(messageId)) return problem('请输入 1–500 字的私信。');
    const message = await friends.sendMessage(account, target, messageId, text, now);
    if (message === false) return problem('消息编号已使用，请重新输入。', 409);
    return message ? result({ state: 'friend-message', message }) : problem('双方成为好友后才可以私信。', 403);
  }
  if (action === 'friend-response') {
    if (typeof target !== 'string' || !guestKeyPattern.test(target) || !['accept', 'decline', 'remove'].includes(response)) return problem('好友操作无效。');
    const outcome = await friends.respond(account, target, response);
    if (!outcome) return problem('好友申请已处理或已失效。', 409);
    return result({ state: 'friendship', now, friendship: response });
  }
  if (action === 'history-friend-add') {
    if (!Number.isSafeInteger(input.seq) || input.seq < 1) return problem('请选择一条对局记录。');
    if (!store.history) return problem('历史记录暂时不可用。', 503);
    const match = await store.history.partnerFor(account, input.seq);
    if (!match) return problem('找不到你的这条对局记录。', 404);
    if (!guestKeyPattern.test(match.partner) || match.partner === account) return problem('对方的游客身份暂不可添加。', 409);
    const friendship = await friends.add(
      { account, nickname: match.selfName ?? '匿名玩家' },
      { account: match.partner, nickname: match.partnerName }, now);
    return result({ state: 'friendship', now, friendship });
  }
  const lookup = await store.change(state => {
    const room = typeof code === 'string' && validRoomCode.test(code) && state.rooms[code];
    const previous = room?.previousRound;
    const currentDone = room?.game && room.game.id === round && getProgress(room.game, room.closedAt ?? now).done &&
      (!room.closedAt || now - room.closedAt < lifetime);
    const players = previous?.id === round && previous.expires > now ? previous.players : currentDone ? room.players : null;
    if (!players) return problem('完成双人对局后才可发送好友申请。', 409);
    const index = players.findIndex(player => player.id === input.id && player.account === account);
    if (index < 0) return problem('只有本局玩家可以添加对方。', 403);
    const peer = players[1 - index];
    if (!peer?.account || peer.account === account) return problem('对方的游客身份暂不可添加。', 409);
    return result({ self: players[index], peer });
  });
  if (lookup.status !== 200) return lookup;
  const friendship = await friends.add(lookup.value.self, lookup.value.peer, now);
  return result({ state: 'friendship', now, friendship });
}

export function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function friendIdentity(request, friends, origin, settings) {
  const user = request.headers.get('oai-authenticated-user-id');
  if (request.method === 'GET') {
    return json({ signedIn: !!user, syncAvailable: !!user || !!settings.IDENTITY_PROXY_KEY || !!settings.SITES_SIGN_IN,
      ...(settings.SITES_SIGN_IN && { sitesSignIn: true }),
      guestKey: user ? await friends.identity(user) : undefined });
  }
  if (request.method !== 'POST') return json({ error: '请求方式无效。' }, 405);
  if (!user || request.headers.get('Origin') !== origin) return json({ error: '请先登录站点账号。' }, 403);
  const body = await request.json().catch(() => null);
  if (typeof body?.guestKey !== 'string' || !guestKeyPattern.test(body.guestKey)) return json({ error: '游客身份无效。' }, 400);
  if (!await friends.bindIdentity(user, body.guestKey)) return json({ error: '此账号或好友列表已绑定。' }, 409);
  return json({ signedIn: true, guestKey: body.guestKey });
}

async function submitPlayerReport(store, moderation, secret, input, now, files, bucket) {
  if (!input.account || input.adult !== true) return json({ error: '请先确认已年满 18 岁。' }, 403);
  if (!moderation || !secret) return json({ error: '举报服务暂时不可用。' }, 503);
  const { source, reason } = input;
  const detail = typeof input.detail === 'string' ? input.detail.trim() : '';
  if (!['online', 'room-list', 'room', 'result'].includes(source) || !reportReasons.includes(reason) || !detail || detail.length > 600) {
    return json({ error: '请选择举报原因，并填写 1–600 字的详情。' }, 400);
  }
  let target;
  if (source === 'online') {
    if (typeof input.target !== 'string' || !guestKeyPattern.test(input.target)) return json({ error: '请选择要举报的玩家。' }, 400);
    const { value } = await store.change(state => {
      const online = availablePlayer(state, input.target);
      const standby = Object.values(state.rooms).find(room => !room.closedAt && room.players.some(
        player => player.account === input.target && player.queueOpen && now - player.seen < lifetime
      ))?.players.find(player => player.account === input.target);
      const player = online?.published && now - online.seen < lobbyLifetime ? online : standby;
      return result(player ? { target: player.account, nickname: player.nickname, network: player.network,
        context: `online/${Math.floor(now / 86_400_000)}` } : null);
    });
    target = value;
  } else if (source === 'room-list') {
    if (typeof input.watchKey !== 'string' || !validId.test(input.watchKey) || !['controller', 'receiver'].includes(input.role)) {
      return json({ error: '请选择房间里的举报对象。' }, 400);
    }
    const { value } = await store.change(state => {
      const room = Object.values(state.rooms).find(item => !item.closedAt && item.watch?.key === input.watchKey && publicWatch(item) &&
        item.game && !getProgress(item.game, now).done && item.players.every(player => now - player.seen < lifetime));
      const seat = room && (input.role === 'controller' ? room.controller : 1 - room.controller);
      const player = room?.players[seat];
      return result(player?.account ? { target: player.account, nickname: player.nickname, network: player.network,
        room: room.code, context: `${room.code}/${room.game.id}/${room.partnerRevision ?? 0}` } : null);
    });
    target = value;
  } else {
    target = await openReportContext(secret, input.token, input.account, now);
  }
  if (!target || target.target === input.account) return json({ error: '举报对象已不可用或举报入口已过期。' }, 409);
  if (files.length && !bucket) return json({ error: '附件服务暂时不可用，请稍后重试。' }, 503);
  const attachments = await validateReportFiles(files);
  if (!attachments) return json({ error: '请选择支持的图片或视频，最多 3 个，总大小不超过 24 MB。' }, 400);
  const report = { ...target, id: crypto.randomUUID(), reporter: input.account, source, reason, detail, now, attachments };
  let id = await moderation.add(report);
  if (!id && bucket) {
    const expired = await moderation.recoverUpload(report.reporter, report.target, report.context, now);
    if (expired) {
      await bucket.delete(expired.attachments.map((_, index) => reportFileKey(expired.id, index))).catch(() => {});
      id = await moderation.add(report);
    }
  }
  if (!id) return json({ error: '近期已提交过这条举报，或举报次数已达上限。' }, 429);
  if (attachments.length) {
    const keys = attachments.map((_, index) => reportFileKey(id, index));
    try {
      for (let index = 0; index < files.length; index += 1) {
        await bucket.put(keys[index], await files[index].arrayBuffer());
      }
      if (!await moderation.finishUpload(id)) throw new Error('Report upload reservation expired');
    } catch {
      const cancelled = await moderation.cancelUpload(id).catch(() => false);
      if (cancelled) await bucket.delete(keys).catch(() => {});
      return json({ error: '附件上传未完成，内容已保留在表单中，请重试。' }, 503);
    }
  }
  return json({ state: 'report-submitted' }, 201);
}

async function adminReports(request, settings, moderation, origin) {
  if (!isSiteAdmin(request, settings)) return json({ error: '请登录管理后台。' }, 403);
  if (!moderation) return json({ error: '举报服务暂时不可用。' }, 503);
  if (request.method === 'GET') {
    const page = Number(new URL(request.url).searchParams.get('page') ?? 1);
    if (!Number.isSafeInteger(page) || page < 1) return json({ error: '页码无效。' }, 400);
    return json(await moderation.list(page));
  }
  if (request.method !== 'POST' || request.headers.get('Origin') !== origin) return json({ error: '请从管理员页面发起请求。' }, 403);
  const raw = await request.text();
  let input;
  try { if (raw.length <= 1000) input = JSON.parse(raw); } catch {}
  if (typeof input?.id !== 'string' || !validId.test(input.id) || !['dismiss', 'ban', 'unban'].includes(input.action) ||
    (input.action === 'ban' && (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 525_600))) {
    return json({ error: '请选择有效的处理操作和封禁时长。' }, 400);
  }
  const now = Date.now();
  const until = input.action === 'ban' ? now + input.minutes * 60_000 : null;
  const status = await moderation.decide(input.id, input.action, request.headers.get('oai-authenticated-user-id'), now, until);
  return status ? json({ status, banUntil: until }) : json({ error: '这条举报已被处理，请刷新列表。' }, 409);
}

export async function guestAccount(key) {
  if (typeof key !== 'string' || !guestKeyPattern.test(key)) return;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function api(request, store, settings, friends = localFriends, moderation, sourceIp, reportBucket, voiceSamples, archiveOnly = false, archiveCutoff = Date.now()) {
  const { pathname, origin } = new URL(request.url);
  if (pathname === '/api/voice-sample' || pathname.startsWith('/api/voice-sample/')) {
    return voiceSampleApi(request, voiceSamples, settings, moderation, sourceIp);
  }
  if (pathname === '/api/admin/reports') return adminReports(request, settings, moderation, origin);
  if (pathname.startsWith('/api/admin/report-files/')) {
    if (!isSiteAdmin(request, settings)) return json({ error: '请登录管理后台。' }, 403);
    const path = /^\/api\/admin\/report-files\/([0-9a-f-]{36})\/([0-2])$/.exec(pathname);
    if (!path || !['GET', 'HEAD'].includes(request.method)) return json({ error: '找不到附件。' }, 404);
    if (!moderation || !reportBucket) return json({ error: '附件服务暂时不可用。' }, 503);
    const index = Number(path[2]);
    const attachment = await moderation.file(path[1], index);
    return attachment ? serveReportFile(request, reportBucket, path[1], index, attachment) : json({ error: '找不到附件。' }, 404);
  }
  if (pathname === '/api/friend-identity') return friendIdentity(request, friends, origin, settings);
  if (pathname === '/api/config' && request.method === 'GET') return json({ iceServers: iceServers() });
  if (pathname === '/api/active-rooms' && request.method === 'GET') {
    const { value, status } = await store.change(state => result({ rooms: activeWatchDirectory(state, Date.now()) }));
    return json(value, status);
  }
  const relayExchange = pathname === '/api/relay';
  if (pathname === '/api/admin' && !isSiteAdmin(request, settings)) {
    return json({ error: '请登录管理后台。' }, 403);
  }
  if (pathname === '/api/admin' && request.method === 'GET') {
    const { value, status } = await store.change(state => adminSnapshot(state, Date.now()));
    return json(value, status);
  }
  if ((pathname !== '/api/room' && !relayExchange) || request.method !== 'POST') return json({ error: '找不到这个接口。' }, 404);
  const from = request.headers.get('Origin');
  if (from && from !== origin) return json({ error: '请从游戏页面发起请求。' }, 403);
  let input;
  let files = [];
  const multipart = pathname === '/api/room' && request.headers.get('Content-Type')?.startsWith('multipart/form-data;');
  try {
    if (multipart) ({ input, files } = await readReportFiles(request));
    else {
      const payload = await request.text();
      if (payload.length > 24_000) return json({ error: '请求过大。' }, 413);
      input = JSON.parse(payload);
    }
  } catch (error) {
    if (multipart && error instanceof RangeError) return json({ error: '附件总大小超过限制。' }, 413);
    return json({ error: '无法读取请求。' }, 400);
  }
  if (multipart && input?.action !== 'report-player') return json({ error: '只能在提交举报时上传附件。' }, 400);
  if (!input || typeof input.id !== 'string' || !validId.test(input.id) || (!relayExchange && !actions.has(input.action))) {
    return json({ error: '请求无效，请刷新页面。' }, 400);
  }
  if (archiveOnly && !['history', 'history-friend-add', 'lobby', 'friend-response', 'friend-chat', 'friend-message', 'friend-presence'].includes(input.action)) {
    if (input.action === 'sync' || input.action === 'match') return json({ state: 'closed', now: Date.now() });
    return json({ error: '临时开放期间仅可查看对局历史和处理好友。', code: 'archive-only' }, 503);
  }
  if (input.limits !== undefined && !validRoundLimits(input.limits)) return json({ error: '请输入有效的时长范围与强度上限。' }, 400);
  const { guestKey } = input;
  input.account = await guestAccount(guestKey);
  const now = Date.now();
  const secret = settings.MODERATION_KEY;
  input.network = await moderationNetwork(sourceIp, secret);
  const bans = moderation && secret ? await moderation.active(now) : [];
  const blocked = (account, network) => bans.find(ban => ban.until > now && (ban.target === account || (network && ban.network === network)));
  if (!['leave', 'watch-leave', 'lobby-away'].includes(input.action)) {
    const ban = blocked(input.account, input.network);
    if (ban) return json({ error: '此账号或网络已被封禁。', code: 'moderation-banned', banUntil: ban.until }, 403);
  }
  if (input.action === 'friend-presence') {
    if (!input.account || input.adult !== true) return json({ error: '请先确认身份。' }, 403);
    if (input.sharing !== undefined && !['show', 'hide'].includes(input.sharing)) return json({ error: '在线状态设置无效。' }, 400);
    return json({ friends: await friends.presence(input.account, input.id, input.sharing, now) });
  }
  if (archiveOnly && input.action === 'lobby') {
    if (!input.account || input.adult !== true) return json({ error: '请先确认身份。' }, 403);
    return json({ state: 'social', now, players: [], standby: [], incoming: [], friends: await friends.list(input.account) });
  }
  if (input.action === 'match' && input.queueHeartbeat === true && input.adult === true && input.account &&
      typeof input.matchId === 'string' && validId.test(input.matchId) && store.freshMatch && await store.freshMatch(input, now)) {
    return json({ state: 'queued', now });
  }
  if (input.action === 'report-player') return submitPlayerReport(store, moderation, secret, input, now, files, reportBucket);
  if (input.action === 'history') {
    if (!input.account || input.adult !== true) return json({ error: '请先确认身份。' }, 403);
    if (!store.history) return json({ error: '历史记录暂时不可用。' }, 503);
    const { view, search = '', beforeAt = Number.MAX_SAFE_INTEGER, beforeSeq = Number.MAX_SAFE_INTEGER } = input;
    if (!['rounds', 'partners'].includes(view) || typeof search !== 'string' || search.length > 40 ||
      !Number.isSafeInteger(beforeAt) || beforeAt < 1 || !Number.isSafeInteger(beforeSeq) || beforeSeq < 1) {
      return json({ error: '历史查询条件无效。' }, 400);
    }
    if (archiveOnly) await store.history.recoverPausedRounds?.(input.account, archiveCutoff, archiveCutoff - membershipLifetime);
    else await store.change(state => { sweep(state, now); return result({}); });
    const page = await store.history.list(input.account, view, search.trim(), beforeAt, beforeSeq);
    const roster = page.items.length ? new Map((await friends.list(input.account)).map(friend => [friend.id, friend.status])) : new Map();
    return json({ ...page, items: page.items.map(({ partner, ...row }) => ({
      ...row, friendship: partner !== input.account && guestKeyPattern.test(partner) ? roster.get(partner) ?? 'available' : undefined
    })) });
  }
  if (relayExchange) {
    const validSession = input.watchRequest !== undefined
      ? typeof input.watchRequest === 'string' && validId.test(input.watchRequest) && [0, 1].includes(input.watchSeat)
      : typeof input.code === 'string' && validRoomCode.test(input.code) && typeof input.voiceId === 'string' && validId.test(input.voiceId);
    if (input.action === 'push') {
      input.packets ??= [input.packet];
      if (!Array.isArray(input.packets) || !input.packets.length || input.packets.length > relayBatchLimit ||
        !input.packets.every(validRelayPacket)) return json({ error: '语音数据无效。' }, 400);
    }
    if (!validSession ||
      !['push', 'pull'].includes(input.action) ||
      (input.after !== undefined && (!Number.isSafeInteger(input.after) || input.after < 0))) return json({ error: '语音数据无效。' }, 400);
    if (!input.account) return json({ error: '语音连接已结束。' }, 403);
    input.after ??= 0;
    const packets = await store.relay.exchange(input, now);
    if (packets === null) return json({ error: '语音连接已结束。' }, 403);
    if (packets === false) return json({ error: '语音发送过快。' }, 429);
    return json(packets);
  }
  if (input.action === 'relay-key' && !await validRelayPublicKey(input.publicKey)) return json({ error: '语音密钥无效。' }, 400);
  if (['watch-send', 'watch-receive'].includes(input.action) && input.data?.relayKey !== undefined &&
    !await validRelayPublicKey(input.data.relayKey)) return json({ error: '旁听语音密钥无效。' }, 400);
  const roster = lobbyActions.includes(input.action) && input.account && input.adult === true ? await friends.list(input.account) : [];
  const scopedCode = input.action === 'sync' ? input.code ?? input.standbyCode : input.code;
  const roomCode = roomActions.includes(input.action) && typeof scopedCode === 'string' && validRoomCode.test(scopedCode) ? scopedCode : undefined;
  let lobbySnapshot;
  const apply = state => {
    if (bans.length) {
      state.queue = state.queue.filter(player => !blocked(player.account, player.network));
      for (const room of Object.values(state.rooms)) {
        if (!room.closedAt && room.players.some(player => blocked(player.account, player.network))) closeRoom(room, now, state);
      }
      for (const [account, player] of Object.entries(state.online ?? {})) {
        if (blocked(account, player.network)) delete state.online[account];
      }
    }
    const next = update(state, input, Date.now(), roster);
    if (input.action === 'lobby' && next.value.state === 'social') lobbySnapshot = next.value;
    return next;
  };
  const response = friendActions.includes(input.action) ? await changeFriend(store, friends, input, now)
    : await Promise.resolve().then(() => store.change(apply, roomCode, input)).catch(error => {
      if (lobbySnapshot && /overloaded|too many resources|temporarily unavailable/i.test(error.message)) {
        return result({ ...lobbySnapshot, presenceDelayed: true });
      }
      throw error;
    });
  const { value, status } = response;
  if (secret && input.account && response.reportTarget) {
    const { nickname } = response.reportTarget;
    const expires = now + reportWindow;
    const token = await sealReportContext(secret, { ...response.reportTarget, reporter: input.account, expires });
    const report = { token, nickname, expires };
    if (value.state === 'room') value.room.report = report;
    else if (value.state === 'closed') value.recentReport = report;
  }
  if (value.state === 'social' && voiceSamples && input.voicePreviewList === true) {
    const players = [...value.players, ...value.standby, ...value.friends.filter(friend => friend.status === 'friend')];
    try {
      const available = await voiceSamples.available([...new Set(players.map(player => player.id))]);
      for (const player of players) if (available.has(player.id)) player.voiceSample = true;
    } catch (error) {
      console.warn('Voice sample directory unavailable', error.message);
    }
  }
  if (value.state === 'ice') value.iceServers = await authorizedIceServers(settings);
  return json(value, status);
}

export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'microphone=(self), camera=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'"
};
