import { VoiceSampleEditor, voiceSampleEditor } from './voice-sample.js';
import { cleanCustomHint, coachHintGroups, coachHints, customHintCount, customHintLimit, cues, defaultRoundSeconds, durationPresets, extensions, fitRoundSeconds, focusOptions, getProgress, maxIntensity, maxRoundMinutes, normalizeRoundLimits, paces, plan, receiverReplies, roundPhases, shortStops, tempos, validRoundLimits, validRoundSeconds, withinRoundLimits } from './pace.js';
import { RoomVoice, voiceError } from './voice.js';
import { RelayVoice } from './relay.js';
import { AudienceVoice, WatchView, watchStatuses } from './watch.js';
import { RoomChat } from './chat.js';
import { FriendChat } from './friend-chat.js';
import { maxReportFiles, maxReportBytes, reportFileAccept } from './report-files.js';
import { HistoryView, recordPractice } from './history.js';
import { desiredGender, genders, normalizeProfile, orientations, roles, targets, voicePreferences } from './preferences.js';

const paths = {
  wave: '<path d="M2 12h4l3-6 4 12 3-6h6"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/><circle cx="9" cy="7" r="4"/>',
  door: '<path d="M4 21h16M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M14 12h.01"/>',
  user: '<circle cx="12" cy="8" r="3.4"/><path d="M5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M9 22h6"/>',
  micOff: '<path d="m3 3 18 18M9 9v3a3 3 0 0 0 5.2 2M9 5a3 3 0 0 1 6 0v5m-8 5a6 6 0 0 0 9 2M5 10v2m14-2v2c0 .6-.1 1.2-.2 1.8M12 18.5V22M9 22h6"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H5m6 6-6-6 6-6"/>',
  zap: '<path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/>',
  book: '<path d="M12 7C9 4 6 4 3 5v14c3-1 7-1 9 2 2-3 6-3 9-2V5c-3-1-6-1-9 2v14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.2A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2A1.6 1.6 0 0 0 15 4.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2A1.6 1.6 0 0 0 19.4 15Z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  key: '<circle cx="8" cy="9" r="5"/><path d="m12 13 8 8m-1-5-3 3m1-5-3 3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  shield: '<path d="m12 22-1-.6C7 19.1 4 15.2 4 11V5l8-3 8 3v6c0 4.2-3 8.1-7 10.4l-1 .6Z"/><path d="m9 12 2 2 4-4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  pause: '<path d="M9 5H6v14h3zm9 0h-3v14h3z"/>',
  play: '<path d="m8 5 12 7-12 7Z"/>',
  hand: '<path d="M7 13V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1.5a5 5 0 0 1-4.1-2.2L4 14a1.5 1.5 0 0 1 2.4-1.8L9 15"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  trophy: '<path d="M8 21h8m-4-5v5m5-17H7v6a5 5 0 0 0 10 0V4ZM7 6H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4"/>',
  volume: '<path d="M3 9v6h4l5 4V5L7 9H3Zm13 0a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12"/>',
  volumeOff: '<path d="M3 9v6h4l5 4V5L7 9H3Zm13 1 5 5m0-5-5 5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  media: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.4"/><path d="m4 17 5-4 3 2 4-5 4 5"/>'
};

const $ = selector => document.querySelector(selector);
const dialog = $('#dialog');
const roomElement = $('#room');
const archiveMode = document.body.hasAttribute('data-archive-ms');
const playerId = loadPlayerId();
const friendPresenceTab = randomClientId();
const friendPresenceKey = 'jianke-friend-presence';
const friendPresenceToggle = $('#share-friend-presence');
let shareFriendPresence = false;
let friendPresenceShared = false;
let friendPresenceRequest;
let onlineFriends = new Set();
try { shareFriendPresence = localStorage.getItem(friendPresenceKey) === 'on'; } catch {}
let guestKey = loadGuestKey();
let friendIdentity;
const identityReady = fetch('/api/friend-identity', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
  .then(async response => {
    if (!response.ok) return;
    friendIdentity = await response.json();
    guestKey = friendIdentity.guestKey ?? guestKey;
  }).catch(() => {});
let mode = 'lobby';
let currentRoom;
let standbyStatus;
let solo;
let voice;
let audienceVoice;
let spectator;
let watchKey;
let roomChat;
let friendChat;
let voiceSample;
let roomVersion = 0;
let after = 0;
let offset = 0;
let lostSince = 0;
let pollError;
let net = Promise.resolve();
let toastTimeout;
let mutedUntil = 0;
let stageKey = '';
let sideKey = '';
let controlKey = '';
let heard = '';
let lastBeat = -1;
let audioContext;
let pendingRoomChime;
let pendingPoll = false;
let matchIntent;
let confirmedMatchId;
let pendingWatchJoin = false;
let pollFailures = 0;
let pollRetryAt = 0;
let lastQueuePoll = 0;
let pendingActiveRooms = false;
let busyMic = false;
let silencedVoice;
let lastRound;
let recentReport;
let reportDraft;
let moderationRetryAt = 0;
try { recentReport = JSON.parse(sessionStorage.getItem('jianke-recent-report')); } catch {}
let sentForRound;
let socialView;
const directoryActions = { online: 'online-players', rooms: 'room-list', friends: 'my-friends', history: 'open-history' };
const onlineVoiceLabels = { ...voicePreferences, any: '开麦不限', self: voicePreferences.peer, peer: voicePreferences.self };
const onlineFilterOptions = {
  'online-gender': { all: '全部性别', ...genders },
  'online-filter-role': { all: '全部角色', ...roles },
  'online-filter-voice': { all: '全部开麦偏好', ...onlineVoiceLabels }
};
let socialData;
let pendingSocial = false;
let socialLoadFailed = false;
let queueConflict = false;
let departurePending;
try { departurePending = JSON.parse(sessionStorage.getItem('jianke-pending-leave')) || undefined; } catch {}

function rememberDeparture(pending) {
  departurePending = pending;
  try {
    if (pending) sessionStorage.setItem('jianke-pending-leave', JSON.stringify(pending));
    else sessionStorage.removeItem('jianke-pending-leave');
  } catch {}
}

function loadGuestKey() {
  let key;
  try {
    const saved = localStorage.getItem('jianke-guest');
    if (/^[0-9a-f]{64}$/.test(saved)) key = saved;
  } catch {}
  try {
    const backup = document.cookie.split('; ').find(value => value.startsWith('jianke-guest-backup='))?.split('=')[1];
    if (!key && /^[0-9a-f]{64}$/.test(backup)) key = backup;
  } catch {}
  key ??= Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  try {
    localStorage.setItem('jianke-guest', key);
  } catch {}
  try { document.cookie = `jianke-guest-backup=${key}; Max-Age=31536000; Path=/; SameSite=Strict; Secure`; } catch {}
  return key;
}

function loadPlayerId() {
  try {
    const saved = sessionStorage.getItem('jianke-player');
    if (/^[0-9a-f-]{36}$/i.test(saved)) return saved;
  } catch {}
  const id = randomClientId();
  try { sessionStorage.setItem('jianke-player', id); } catch {}
  return id;
}

function randomClientId() {
  return crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(18)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function saveMatchIntent(values) {
  matchIntent = values;
  confirmedMatchId = undefined;
  try {
    if (values) sessionStorage.setItem('jianke-match', JSON.stringify(values));
    else sessionStorage.removeItem('jianke-match');
  } catch {}
}

function loadPreferences() {
  try {
    return { sound: true, speech: false, adult: false, nickname: '', ...JSON.parse(localStorage.getItem('jianke-preferences')) };
  } catch {
    return { sound: true, speech: false, adult: false, nickname: '' };
  }
}

const preferences = loadPreferences();
preferences.profile = normalizeProfile(preferences.profile);
preferences.limits = normalizeRoundLimits(preferences.limits);
if (!Object.hasOwn(genders, preferences.publicGender)) preferences.publicGender = 'unspecified';
function savePreferences() {
  if (!preferences.sound) pendingRoomChime = undefined;
  try {
    localStorage.setItem('jianke-preferences', JSON.stringify(preferences));
  } catch {
    // Preferences still work for this visit in storage-restricted browsers.
  }
  $('#profile-name').textContent = preferences.nickname || '游客';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? ''}</svg>`;
}

function icons(root) {
  for (const element of root.querySelectorAll('[data-icon]')) element.innerHTML = icon(element.dataset.icon);
}

function button(action, label, symbol, variant = 'outline', disabled = false) {
  return `<button class="button ${variant}" data-action="${action}"${disabled ? ' disabled' : ''}>${symbol ? `<span data-icon="${symbol}"></span>` : ''}${label}</button>`;
}

function showToast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => element.classList.remove('show'), 3600);
}

function popup(title, body) {
  dialog.querySelector('.voice-sample audio')?.pause();
  voiceSample?.destroy();
  voiceSample = undefined;
  friendChat = undefined;
  dialog.innerHTML = `<div class="dialog-panel"><div class="dialog-top"><h2 id="dialog-title">${title}</h2>
    <button class="icon-button" data-action="close" data-icon="close" aria-label="关闭"></button></div>${body}</div>`;
  icons(dialog);
  if (!dialog.open) dialog.showModal();
}

function rememberReport(report) {
  if (!report?.token) return;
  recentReport = report;
  try { sessionStorage.setItem('jianke-recent-report', JSON.stringify(report)); } catch {}
}

function openReport(source, target, context) {
  if (!['online', 'room-list'].includes(source) && !context?.token) return showToast('举报入口已过期。');
  const name = context?.nickname || '匿名玩家';
  reportDraft = { source, target, token: context?.token, watchKey: context?.watchKey };
  const participant = source === 'room-list' ? '<label class="field">举报对象<select name="role" required><option value="">请选择玩家角色</option><option value="controller">领拍者</option><option value="receiver">跟拍者</option></select></label>' : '';
  popup(`举报 · ${escapeHtml(name)}`, `<form id="report-form">
    ${participant}
    <label class="field">举报原因<select name="reason" required>
      <option value="">请选择原因</option><option>骚扰或辱骂</option><option>未经同意的行为</option><option>垃圾信息或引流</option>
      <option>冒充身份</option><option>其他</option>
    </select></label>
    <label class="field">事情详情<textarea name="detail" required maxlength="600" rows="4" placeholder="说明发生了什么，以及大致时间"></textarea></label>
    <label class="field">图片或视频附件<input type="file" name="attachments" accept="${reportFileAccept}" multiple aria-describedby="report-attachment-limit"></label>
    <p class="profile-hint" id="report-attachment-limit">可选，最多 ${maxReportFiles} 个，总大小不超过 ${maxReportBytes / 1024 / 1024} MB。</p>
    <p class="form-error" role="alert" hidden></p>
    <div class="dialog-actions">${button('close', '取消')}<button class="button primary" type="submit">提交举报</button></div></form>`);
}

async function sendReport(form, data) {
  const payload = { ...reportDraft, reason: data.get('reason'), detail: data.get('detail'), role: data.get('role') };
  const files = data.getAll('attachments').filter(file => file.name);
  const feedback = form.querySelector('.form-error');
  if (files.length > maxReportFiles || files.some(file => !file.size) || files.reduce((total, file) => total + file.size, 0) > maxReportBytes) {
    feedback.textContent = '请选择有效的文件，最多 3 个，总大小不超过 24 MB。';
    feedback.hidden = false;
    return;
  }
  feedback.hidden = true;
  const controls = [...form.querySelectorAll('button')];
  const submit = form.querySelector('[type="submit"]');
  submit.textContent = files.length ? '正在上传…' : '正在提交…';
  controls.forEach(control => { control.disabled = true; });
  try {
    await identityReady;
    await roomRequest('report-player', payload, files);
    if (form.isConnected && dialog.open) dialog.close();
    showToast('举报已提交，等待管理员审核。');
  } catch (error) {
    feedback.textContent = ['TimeoutError', 'AbortError'].includes(error.name) ? '提交超时，请重试。' : error.message;
    feedback.hidden = false;
  } finally {
    submit.textContent = '提交举报';
    controls.forEach(control => { control.disabled = false; });
  }
}

function openFriendChat(target) {
  const friend = socialData?.friends.find(entry => entry.id === target && entry.status === 'friend');
  if (!friend) return;
  popup(`私信 · ${escapeHtml(friend.nickname || '匿名玩家')}`, `<section class="friend-chat" aria-label="好友私信">
    <button type="button" class="button outline friend-chat-older" hidden>加载更早的消息</button>
    <ol class="chat-log" role="log" aria-label="私信消息" tabindex="0" hidden></ol>
    <p class="friend-chat-status" role="status">正在加载私信…</p>
    <form>
      <div class="chat-compose">
        <input type="text" maxlength="500" aria-label="输入私信" placeholder="输入私信" autocomplete="off" enterkeyhint="send" required disabled>
        <button type="submit" class="button primary" disabled>发送</button>
      </div>
    </form></section>`);
  friendChat = new FriendChat(dialog.querySelector('.friend-chat'), async (action, values) => {
    await identityReady;
    return roomRequest(action, { target, ...values });
  }, randomClientId, () => {
    const entry = socialData?.friends.find(item => item.id === target);
    if (entry?.unread) {
      delete entry.unread;
      renderSocial();
    }
  });
}

function confirmAge(next) {
  if (preferences.adult) return next();
  popup('进入前确认', `<p>双人节拍仅面向年满 18 岁的玩家。请尊重彼此的意愿，任何一方都可随时暂停或退出。</p>
    <div class="dialog-actions">${button('close', '返回')}${button('confirm-age', '我已年满 18 岁', 'check', 'primary')}</div>`);
  ageNext = next;
}
let ageNext;

function guide() {
  const rules = [
    ['zap', '加快', '看到绿色指令时，跟随较快的节拍。'],
    ['wave', '放慢', '看到暖黄色指令时，跟随较慢的节拍。'],
    ['hand', '停拍', '看到粉色指令时停下，并按「我已停拍」记录。每个停顿可记录一次。'],
    ['users', '双人互动', '领拍者可调节拍、强度与动作焦点。跟拍者可回馈速度、强度和接近极限程度，也可立即暂停。加时需双方确认。'],
  ];
  const body = rules.map(([symbol, title, detail]) => `<div class="rule"><span data-icon="${symbol}"></span><div><strong>${title}</strong><p>${detail}</p></div></div>`).join('');
  popup('玩法说明', `${body}<div class="dialog-actions">${button('close', '知道了', 'check', 'primary')}</div>`);
}

function privacy() {
  popup('隐私与语音', `<p>使用临时游客身份即可游玩。好友房凭房间码或邀请链接加入。</p>
    <p>公开在线列表需主动开启，展示昵称、角色、你选的公开性别和对局偏好。公开性别默认为「不透露」。匹配性别和性取向用于随机匹配。使用同一浏览器可找回好友列表。</p>
    <p>双方同意后，可各自开麦、静音或结束语音。语音优先在浏览器之间直连，兼容模式会由浏览器加密音频，再由站点临时转发密文。</p>
    <p>准备开局时可以选择是否公开观战。双方都允许时，首页会列出该对局，观众进房后可查看玩家昵称、当前节奏和进度。</p>
    <p>双方选择「允许旁听申请」后，观众进房即可听到开麦语音。任一方选择「禁止旁听申请」，旁听就会停止。</p>
    <p>站点统计公开页面的浏览量，并用随机浏览器标识计算独立访客。访问统计与游戏身份分开。</p>
    <p>离开房间会关闭麦克风并结束连接。勿在随机匹配中分享个人信息。</p>
    <div class="dialog-actions">${button('close', '知道了', 'check', 'primary')}</div>`);
}

function settings() {
  popup('游玩设置', `<form id="settings-form">
    <label class="field">游客昵称<input name="nickname" maxlength="16" placeholder="输入昵称（可选）" value="${escapeHtml(preferences.nickname)}" autocomplete="off"></label>
    <label class="toggle"><input name="sound" type="checkbox" ${preferences.sound ? 'checked' : ''}>播放节拍和匹配提示音</label>
    <label class="toggle"><input name="speech" type="checkbox" ${preferences.speech ? 'checked' : ''}>开启中文指令播报</label>
    <p>播报使用浏览器的中文语音，房间通话可在房内单独开启。昵称会在下次加入房间时生效。</p>
    <div class="dialog-actions">${button('edit-voice-sample', '录制语音试听')} ${button('close', '取消')}<button class="button primary" type="submit">保存设置</button></div></form>`);
}

function durationField(seconds = defaultRoundSeconds, limits) {
  const { minMinutes, maxMinutes } = normalizeRoundLimits(limits);
  const selected = seconds / 60;
  const presets = durationPresets.filter(minutes => minutes >= minMinutes && minutes <= maxMinutes)
    .map(minutes => `<button type="button" class="duration-option" data-duration="${minutes}" aria-pressed="${minutes === selected}">${minutes} 分钟</button>`).join('');
  return `<fieldset class="duration-field"><legend>每局时长</legend>${presets ? `<div class="duration-presets">${presets}</div>` : ''}
    <label class="duration-custom">自定义<input name="minutes" aria-label="自定义时长（分钟）" type="number" inputmode="numeric" min="${minMinutes}" max="${maxMinutes}" step="1" required value="${selected}">分钟</label>
    <p class="duration-hint">${minMinutes === maxMinutes ? `固定为 ${minMinutes} 分钟。` : `可输入 ${minMinutes}–${maxMinutes} 分钟。`}</p></fieldset>`;
}

function choices(seconds = defaultRoundSeconds, difficulty = 'normal') {
  const levels = Object.entries(paces).map(([key, { label }]) => `<label class="choice"><input type="radio" name="difficulty" value="${key}" ${key === difficulty ? 'checked' : ''}>${label}</label>`).join('');
  return `${durationField(seconds)}
    <fieldset><legend>节奏难度</legend><div class="choices">${levels}</div></fieldset>`;
}

function practice() {
  popup('单人练习', `<p>跟随提示，练习切换加快、放慢和停拍。</p><form id="practice-form">
    ${choices(solo?.seconds, solo?.difficulty)}<div class="dialog-actions"><button class="button primary" type="submit"><span data-icon="play"></span> 开始练习</button></div></form>`);
}

function changeDuration() {
  if (mode === 'solo') return practice();
  popup('调整时长', `<p>双方会看到同一个时长。更改后，双方需重新准备。</p><form id="duration-form">
    ${durationField(currentRoom.seconds, currentRoom.limits)}<p class="form-error" role="alert" hidden></p>
    <div class="dialog-actions">${button('close', '取消')}<button class="button primary" type="submit">应用时长</button></div></form>`);
}

function selectField(name, label, options, selected) {
  const items = Object.entries(options).map(([key, text]) => `<option value="${key}"${key === selected ? ' selected' : ''}>${text}</option>`);
  return `<label class="field">${label}<select name="${name}">${items.join('')}</select></label>`;
}

function roundLimitsField() {
  const { minMinutes, maxMinutes, maxIntensity: intensity } = preferences.limits;
  const levels = Array.from({ length: maxIntensity + 1 }, (_, index) => index);
  return `<fieldset class="round-preferences"><legend>可接受的对局范围</legend><div class="round-preferences-grid">
    <label class="field">最短时长（分钟）<input name="minMinutes" type="number" inputmode="numeric" min="1" max="${maxRoundMinutes}" step="1" required value="${minMinutes}"></label>
    <label class="field">最长时长（分钟）<input name="maxMinutes" type="number" inputmode="numeric" min="1" max="${maxRoundMinutes}" step="1" required value="${maxMinutes}"></label>
    ${selectField('maxIntensity', '最高强度', Object.fromEntries(levels.map(level => [level, level ? `${level} 档` : '关闭强度档位'])), String(intensity))}</div>
    <p class="duration-hint">想固定时长时，最短和最长填同一个数字。</p></fieldset>`;
}

function roleField() {
  const options = Object.entries(roles).map(([role, label]) => `<label class="role-option"><input type="radio" name="role" value="${role}"${role === preferences.profile.role ? ' checked' : ''}>
    <span><strong>${label}</strong><small>${{ either: '匹配时分配', controller: '发送节奏指令', receiver: '跟随对方指令' }[role]}</small></span></label>`);
  return `<fieldset class="role-field"><legend>想担当的角色</legend><div class="role-options">${options.join('')}</div></fieldset>`;
}

function profileFrom(data) {
  return normalizeProfile({ ...preferences.profile, ...Object.fromEntries(data) });
}

function addressFields(profile) {
  return `<fieldset class="address-fields">
    <label class="field">希望被怎么称呼
      <input type="text" name="address" maxlength="16" value="${escapeHtml(profile.address)}" autocomplete="off" placeholder="可选，配对后对方可见">
    </label>
    <input type="hidden" name="shareAddress" value="0">
    <label class="toggle"><input type="checkbox" name="shareAddress" value="1"${profile.shareAddress ? ' checked' : ''}>在公开在线和候补列表显示称呼</label>
  </fieldset>`;
}

function matchPreferences() {
  const profile = preferences.profile;
  popup('设置匹配偏好', `<form id="match-form"><div class="profile-grid">
    ${selectField('gender', '我的性别', genders, profile.gender)}
    ${selectField('orientation', '我的性取向', orientations, profile.orientation)}</div>
    ${roleField()}
    <div class="profile-grid">
      ${selectField('target', '想匹配的性别', targets, profile.target)}
      ${selectField('voice', '开麦偏好', voicePreferences, profile.voice)}
    </div>
    <p class="profile-hint">进房后，语音仍需双方同意，每个人自行开麦。</p>
    ${addressFields(profile)}
    ${roundLimitsField()}
    <p class="profile-hint" id="match-summary"></p><p class="form-error" role="alert" hidden></p>
    <div class="dialog-actions">${button('close', '取消')}<button class="button primary" type="submit"><span data-icon="zap"></span> 开始匹配</button></div></form>`);
  const form = $('#match-form');
  const refresh = () => {
    const target = desiredGender(profileFrom(new FormData(form)));
    form.querySelector('#match-summary').textContent = `本次匹配：${targets[target]}。时长需有重叠，强度以上限较低的一方为准。`;
  };
  form.addEventListener('change', refresh);
  refresh();
}

function friend(code = '') {
  popup('好友房间', `<p>创建双人房发给好友，或输入对方提供的房间码。</p>
    <form id="friend-form">
      <label class="field room-field">房间码<input name="roomCode" value="${escapeHtml(code)}" maxlength="6" placeholder="输入 6 位房间码" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
      ${roleField()}
      ${roundLimitsField()}
      <p class="form-error" role="alert" hidden></p>
      <div class="dialog-actions">${button('create-friend', '创建房间', 'key')}<button class="button primary" type="submit">加入房间</button></div>
    </form>`);
}

function createFriend() {
  popup('创建好友房', `<form id="create-form">${roleField()}${roundLimitsField()}${choices(fitRoundSeconds(defaultRoundSeconds, preferences.limits))}<p class="form-error" role="alert" hidden></p>
    <div class="dialog-actions">${button('friend', '返回')}<button class="button primary" type="submit">创建并邀请</button></div></form>`);
}

function setDirectory(view) {
  socialView = view;
  $('#active-rooms').hidden = view !== 'rooms';
  $('#round-history').hidden = view !== 'history';
  $('#social').hidden = view !== 'online' && view !== 'friends';
  for (const [name, action] of Object.entries(directoryActions)) {
    $(`[data-action="${action}"]`).setAttribute('aria-expanded', String(name === view));
  }
}

function openSocial(view) {
  if (view === socialView) return closeSocial();
  setDirectory(view);
  if (view === 'rooms') {
    $('#active-rooms-title').focus();
    return refreshActiveRooms();
  }
  if (view === 'history') {
    $('#history-title').focus();
    return historyView.open();
  }
  $('#social-title').textContent = view === 'online' ? '在线列表' : '我的好友';
  $('#online-options').hidden = view !== 'online';
  $('#friend-sync').hidden = view !== 'friends';
  $('#friend-presence-option').hidden = view !== 'friends';
  if (view === 'friends') {
    renderFriendSync();
    refreshFriendPresence();
  }
  $('#show-online').checked = preferences.visible === true;
  $('#online-role').value = preferences.profile.role;
  if (view === 'online') $('#online-limits-form').innerHTML = `
    ${selectField('publicGender', '在线列表与观战房间显示的性别', genders, preferences.publicGender)}
    ${selectField('voice', '开麦偏好', voicePreferences, preferences.profile.voice)}
    ${addressFields(preferences.profile)}
    ${roundLimitsField()}<p class="form-error" role="alert" hidden></p>
    <button type="submit" class="button outline">保存偏好</button>
    <button type="button" class="button outline" data-action="edit-voice-sample">录制语音试听</button>`;
  renderSocial();
  $('#social-title').focus();
  return refreshLobby(true);
}

async function renderFriendSync() {
  await identityReady;
  const element = $('#friend-sync');
  if (!friendIdentity) {
    element.textContent = '暂时无法检查好友同步状态。';
  } else if (!friendIdentity.syncAvailable) {
    element.textContent = '好友保存在本站，请用同一浏览器访问。';
  } else if (friendIdentity.guestKey) {
    element.textContent = '好友已绑定站点账号。';
  } else if (friendIdentity.signedIn) {
    updateContent(element, button('bind-friends', '绑定当前好友列表'));
  } else if (friendIdentity.sitesSignIn) {
    updateContent(element, '<a class="button outline" href="/signin-with-chatgpt?return_to=%2F%3Ffriends%3D1" target="_top">登录 ChatGPT 同步好友</a>');
  } else {
    element.textContent = '请先通过站点运营方的身份验证入口登录。';
  }
}

async function bindFriends(target) {
  target.disabled = true;
  try {
    const response = await fetch('/api/friend-identity', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guestKey }), signal: AbortSignal.timeout(5000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    friendIdentity = data;
    await renderFriendSync();
    showToast('好友列表已绑定');
  } finally {
    target.disabled = false;
  }
}

function closeSocial() {
  const trigger = directoryActions[socialView];
  setDirectory(undefined);
  if (trigger) $(`[data-action="${trigger}"]`).focus();
}

function socialButton(action, label, target, disabled = false, primary = false) {
  return `<button class="button ${primary ? 'primary' : 'outline'}" data-action="${action}" data-target="${escapeHtml(target)}"${disabled ? ' disabled' : ''}>${label}</button>`;
}

function socialRow(nickname, detail, controls) {
  return `<div class="social-row"><div><strong>${escapeHtml(nickname || '匿名玩家')}</strong><small>${detail}</small></div><div class="social-actions">${controls}</div></div>`;
}

function roundLimitsSummary(limits) {
  const { minMinutes, maxMinutes, maxIntensity: intensity } = normalizeRoundLimits(limits);
  const duration = minMinutes === maxMinutes ? minMinutes : `${minMinutes}–${maxMinutes}`;
  return `${duration} 分钟 · ${intensity ? `最高 ${intensity} 档` : '关闭强度档位'}`;
}

function publicPlayerDetail(player) {
  const gender = Object.hasOwn(genders, player.gender) ? genders[player.gender] : genders.unspecified;
  const voice = onlineVoiceLabels[player.voicePreference] ?? onlineVoiceLabels.any;
  const address = player.address ? ` · 希望称呼 ${escapeHtml(player.address)}` : '';
  return `${gender} · ${roles[player.role]} · ${roundLimitsSummary(player.limits)} · ${voice}${address}`;
}

function updateContent(element, html) {
  if (element.dataset.content === html) return;
  const focus = element.contains(document.activeElement) ? document.activeElement.dataset : null;
  element.dataset.content = html;
  element.innerHTML = html;
  icons(element);
  if (focus) {
    const replacement = [...element.querySelectorAll('button')].find(button => button.dataset.action === focus.action && button.dataset.target === focus.target);
    replacement?.focus();
  }
}

async function refreshActiveRooms() {
  if (archiveMode || mode !== 'lobby' || socialView !== 'rooms' || document.hidden || pendingActiveRooms) return;
  pendingActiveRooms = true;
  const list = $('#active-room-list');
  try {
    const response = await fetch('/api/active-rooms', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error();
    const { rooms } = await response.json();
    const rows = rooms.map(room => {
      const full = room.viewers >= room.viewerLimit;
      const roleGenders = room.roleGenders ?? {};
      const genderLabel = role => Object.hasOwn(genders, roleGenders[role]) ? genders[roleGenders[role]] : genders.unspecified;
      return socialRow(`观战房间 ${room.key.slice(0, 6).toUpperCase()} · 领拍者 ${genderLabel('controller')} / 跟拍者 ${genderLabel('receiver')}`,
        `${watchStatuses[room.status]} · 旁观 ${room.viewers}/${room.viewerLimit} 人${room.publicAudio ? ' · 可直接旁听' : ''}`,
        socialButton('watch-join', full ? '观战已满' : '进入观战', room.key, full) + socialButton('report-list-room', '举报', room.key));
    }).join('');
    updateContent(list, rows || '<p class="social-message">当前没有可观战的对局。</p>');
  } catch {
    updateContent(list, '<p class="social-message">暂时无法加载房间。</p>' + button('refresh-rooms', '重新加载'));
  } finally {
    list.dataset.loading = 'false';
    pendingActiveRooms = false;
  }
}

function renderSocial() {
  const notices = $('#lobby-notices');
  if (lastRound && lastRound.expires <= Date.now() + offset) lastRound = undefined;
  if (recentReport?.expires <= Date.now() + offset) recentReport = undefined;
  const canAddRecent = lastRound && sentForRound !== lastRound.round;
  const recent = canAddRecent || recentReport ? socialRow(lastRound?.nickname || recentReport?.nickname, '最近对局',
    (canAddRecent ? button('add-friend', '加好友', 'user') : '') + (recentReport ? button('report-recent', '举报') : '')) : '';
  const received = socialData?.friends.reduce((count, friend) => count + (friend.status === 'received' ? 1 : friend.unread ?? 0), 0) ?? 0;
  const friendCount = $('#friend-count');
  friendCount.textContent = received ? String(received) : '';
  friendCount.hidden = !received;
  const incoming = (socialData?.incoming ?? []).map(invite => socialRow(invite.nickname, `邀请你一起玩 · ${publicPlayerDetail(invite)}`,
    socialButton('decline-invite', '拒绝', invite.id) + socialButton('accept-invite', '接受邀请', invite.id, false, true))).join('');
  const outgoing = socialData?.outgoing ? '<p class="social-message">邀请已发送，等待对方回应。</p>' : '';
  const queueNotice = departurePending ? '<p class="social-message">正在确认退出，恢复连接后会自动完成。</p>'
    : queueConflict ? socialRow('还有未退出的排队记录', '可清除当前身份的排队记录。', button('clear-queue', '清除排队')) : '';
  updateContent(notices, queueNotice + incoming + outgoing + recent);
  notices.hidden = !(queueNotice || incoming || outgoing || recent);
  if (socialView !== 'online' && socialView !== 'friends') return;
  const invite = player => socialButton('invite-player', socialData.outgoing === player.id ? '等待回应' : '邀请对局', player.id,
    !player.compatible || !!socialData.outgoing);
  const preview = player => player.voiceSample ? socialButton('play-voice-sample', '试听语音', player.id) : '';
  const report = player => socialButton('report-online', '举报', player.id);
  const gender = $('#online-gender').value || 'all';
  const role = $('#online-filter-role').value || 'all';
  const voice = $('#online-filter-voice').value || 'all';
  const compatibleOnly = $('#online-compatible').checked;
  const filtering = gender !== 'all' || role !== 'all' || voice !== 'all' || compatibleOnly;
  $('#reset-online-filters').hidden = !filtering;
  const matchesFilters = player =>
    (gender === 'all' || (player.gender || 'unspecified') === gender) &&
    (role === 'all' || (player.role || 'either') === role) &&
    (voice === 'all' || (player.voicePreference || 'any') === voice) &&
    (!compatibleOnly || player.compatible);
  const players = socialData?.players.filter(matchesFilters).map(player => socialRow(player.nickname,
    `${publicPlayerDetail(player)}${player.compatible ? '' : ' · 偏好不符'}`, invite(player) + preview(player) + report(player))).join('');
  const standby = socialData?.standby?.filter(matchesFilters).map(player => socialRow(player.nickname,
    `${publicPlayerDetail(player)} · ${player.vacant ? '有空位' : `${player.waiting} 人候补`}${player.compatible ? '' : ' · 角色、时长或偏好不符'}`,
    socialButton('standby-join', player.vacant ? '加入对局' : '排队候补', player.id, !player.compatible) + preview(player) + report(player))).join('');
  const friends = socialData?.friends.map(friend => {
    const remove = socialButton('remove-friend', friend.status === 'sent' ? '撤回' : '移除', friend.id);
    if (friend.status === 'received') return socialRow(friend.nickname, '收到好友申请',
      socialButton('decline-friend', '拒绝', friend.id) + socialButton('accept-friend', '同意', friend.id, false, true));
    if (friend.status === 'sent') return socialRow(friend.nickname, '等待对方同意', remove);
    const status = archiveMode ? (onlineFriends.has(friend.id) ? '在线' : '已添加好友')
      : friend.online ? `在线 · ${publicPlayerDetail(friend)}${friend.compatible ? '' : ' · 偏好不符'}` : '离线';
    const unread = friend.unread ? ` · ${friend.unread} 条未读私信` : '';
    return socialRow(friend.nickname, status + unread,
      socialButton('friend-chat', '私信', friend.id) + preview(friend) + (friend.online ? invite(friend) : '') + remove);
  }).join('');
  const empty = socialView === 'online' ? (filtering ? '暂无符合筛选条件的在线玩家。' : '暂时没有公开在线的玩家。')
    : '好友申请和已添加的好友会显示在这里。双人对局结束后，可向对方发送申请。';
  const placeholder = socialData ? empty : socialLoadFailed ? '暂时无法加载列表。' : '正在加载…';
  const retry = socialLoadFailed ? button('refresh-social', '重新加载') : '';
  const rows = (socialView === 'online' ? players : friends) || `<p class="social-message">${placeholder}</p>${socialData ? '' : retry}`;
  const delayed = socialData && (socialLoadFailed
    ? `<p class="social-message">暂时无法刷新，正在显示上次加载的列表。</p>${retry}`
    : socialData.presenceDelayed && preferences.visible ? '<p class="social-message">你的在线状态正在等待更新。</p>' : '');
  updateContent($('#social-list'), (delayed || '') + rows + (socialView === 'online' && standby ? `<h3 class="standby-heading">开放候补的玩家</h3>${standby}` : ''));
}

function lobbyValues() {
  return { adult: preferences.adult, profile: preferences.profile, nickname: preferences.nickname, visible: preferences.visible === true,
    publicGender: preferences.publicGender, limits: preferences.limits,
    voicePreviewList: socialView === 'online' || socialView === 'friends' };
}

function refreshFriendPresence() {
  const sharing = shareFriendPresence ? 'show' : friendPresenceShared ? 'hide' : undefined;
  if (friendPresenceRequest || !preferences.adult || (document.hidden && sharing !== 'hide') ||
      navigator.onLine === false || moderationRetryAt > Date.now()) return friendPresenceRequest;
  friendPresenceRequest = (async () => {
    await identityReady;
    if (sharing === 'show') friendPresenceShared = true;
    const { friends } = await roomRequest('friend-presence', { id: friendPresenceTab, sharing });
    if (sharing === 'hide') friendPresenceShared = false;
    if (!Array.isArray(friends) || document.hidden) return;
    const arrived = friends.filter(friend => !onlineFriends.has(friend.id));
    onlineFriends = new Set(friends.map(friend => friend.id));
    if (arrived.length) {
      const names = arrived.slice(0, 2).map(friend => friend.nickname || '匿名好友').join('、');
      showToast(arrived.length > 2 ? `${names} 等 ${arrived.length} 位好友在线` : `${names} 在线`);
    }
    if (archiveMode && socialView === 'friends') renderSocial();
  })().catch(() => {}).finally(() => { friendPresenceRequest = undefined; });
  return friendPresenceRequest;
}

function setFriendPresence(shared) {
  shareFriendPresence = friendPresenceToggle.checked = shared;
  Promise.resolve(friendPresenceRequest).then(refreshFriendPresence);
}

function refreshLobby(report = false) {
  if ((archiveMode && socialView !== 'friends') || pendingSocial || pendingWatchJoin || mode !== 'lobby' || document.hidden || !preferences.adult || moderationRetryAt > Date.now()) return;
  pendingSocial = true;
  const session = roomVersion;
  return (async () => {
    for (const delay of [0, 700, 1600]) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 250));
      if (session !== roomVersion || mode !== 'lobby' || document.hidden) return;
      try {
        await call('lobby', lobbyValues(), session);
        return;
      } catch (error) {
        if (session !== roomVersion) return;
        socialLoadFailed = true;
        renderSocial();
        const transient = error.status === 429 || error.status >= 500 || ['TypeError', 'TimeoutError', 'AbortError'].includes(error.name);
        if (!transient || delay === 1600 || (!report && socialData)) {
          if (report && !transient) showToast(error.message);
          return;
        }
      }
    }
  })().finally(() => { pendingSocial = false; });
}

async function addFriend(previous) {
  const room = currentRoom;
  const completed = previous ?? (room?.game ? { code: room.code, round: room.game.id } : lastRound);
  if (!completed || sentForRound === completed.round) return;
  const { friendship } = await call('friend-add', { ...completed, adult: preferences.adult });
  sentForRound = completed.round;
  showToast({ friend: '你们已经是好友', sent: '好友申请已发送', received: '对方已申请加你，可在「我的好友」里同意' }[friendship]);
  render();
  renderSocial();
  refreshLobby();
}

async function respondFriend(target, response) {
  await call('friend-response', { target, response, adult: preferences.adult });
  showToast({ accept: '已添加好友', decline: '已拒绝好友申请', remove: '已移除' }[response]);
  await call('lobby', lobbyValues());
}

function activateSound() {
  if (!preferences.sound) return;
  const Context = window.AudioContext ?? window.webkitAudioContext;
  if (!Context) return;
  try {
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new Context();
      audioContext.addEventListener('statechange', playPendingRoomChime);
    }
    if (audioContext.state === 'running') playPendingRoomChime();
    else return audioContext.resume().then(() => {
      playPendingRoomChime();
      render();
    }).catch(() => {});
  } catch {
    // Timers and text cues do not depend on audio hardware.
  }
}

function beat(frequency, volume = .23, length = .085, wave = 'triangle') {
  if (!preferences.sound || audioContext?.state !== 'running') return false;
  const tone = audioContext.createOscillator();
  const envelope = audioContext.createGain();
  const now = audioContext.currentTime;
  tone.type = wave;
  tone.frequency.value = frequency;
  envelope.gain.setValueAtTime(.001, now);
  envelope.gain.linearRampToValueAtTime(volume, now + .006);
  envelope.gain.exponentialRampToValueAtTime(.001, now + length);
  tone.connect(envelope).connect(audioContext.destination);
  tone.start(now);
  tone.stop(now + length);
  return true;
}

function playPendingRoomChime() {
  if (!pendingRoomChime) return;
  const { session, matched } = pendingRoomChime;
  if (session !== roomVersion || mode !== 'online' || !preferences.sound) {
    pendingRoomChime = undefined;
    return;
  }
  const played = matched ? beat(1175, .34, .27, 'sine') : beat(960, .21, .15);
  if (played) pendingRoomChime = undefined;
}

function speak(text) {
  if (!preferences.speech || !('speechSynthesis' in window)) return;
  const chinese = speechSynthesis.getVoices().find(item => /^zh([-_]|$)/i.test(item.lang));
  if (!chinese) return;
  speechSynthesis.cancel();
  const line = new SpeechSynthesisUtterance(text);
  line.lang = chinese.lang;
  line.voice = chinese;
  line.rate = .95;
  speechSynthesis.speak(line);
}

function openScreen(next) {
  mode = next;
  $('#lobby').hidden = true;
  roomElement.hidden = false;
  roomElement.removeAttribute('data-room-panel');
  roomElement.classList.remove('standby-queue');
  stageKey = '';
  sideKey = '';
  controlKey = '';
  heard = '';
  lastBeat = -1;
  roomElement.innerHTML = `<div class="room-head"><div class="room-heading">
    <button class="text-button" data-action="lobby"><span data-icon="back"></span> 返回大厅</button>
    <h1></h1></div><div class="room-head-actions"><button class="button outline" data-action="sound-toggle"${next === 'queue' ? ' hidden' : ''}>节拍声</button>
    <button class="button danger" data-action="end">退出房间</button></div></div>
    <section id="room-voice-panel" class="room-voice" tabindex="-1" aria-label="房间语音" hidden>
      <span class="room-voice-icon" data-icon="mic"></span>
      <div class="room-voice-copy" aria-live="polite"><h2>房间语音</h2><p></p><small class="room-voice-preference" hidden></small></div>
      <div class="voice-actions"></div><div class="voice-audience" hidden></div>
    </section>
    <div class="room-grid"><div class="playfield"><div class="stage-stack"><div class="room-stage"><span class="time-label"></span><div class="stage-content"></div><p class="peer-feedback" role="status" hidden></p><div class="progress"><span></span></div></div>
    <section class="control-dock" aria-label="节奏控制" hidden></section></div>
    <section id="room-chat-panel" class="room-chat" tabindex="-1" aria-label="房间公屏" hidden></section>
    </div><aside id="room-side-panel" class="room-side" tabindex="-1" aria-label="房间信息"></aside></div>
    <button type="button" class="room-panel-backdrop" data-action="close-room-panel" aria-label="关闭房间面板" tabindex="-1"></button>
    <nav class="mobile-room-tools" aria-label="房间工具">
      <button type="button" class="button outline" data-action="room-panel" data-panel="voice" aria-controls="room-voice-panel" aria-expanded="false">语音</button>
      <button type="button" class="button outline" data-action="room-panel" data-panel="chat" aria-controls="room-chat-panel" aria-expanded="false">公屏</button>
      <button type="button" class="button outline" data-action="room-panel" data-panel="more" aria-controls="room-more" aria-expanded="false">进阶</button>
      <button type="button" class="button outline" data-action="room-panel" data-panel="info" aria-controls="room-side-panel" aria-expanded="false">房间</button>
    </nav>`;
  roomChat = next === 'online' ? new RoomChat(roomElement.querySelector('.room-chat'), async values => {
    const { code, standby } = currentRoom;
    const response = await call('room-chat', { ...values, code, partnerRevision: standby?.revision ?? 0 });
    if (response?.state !== 'room') throw new Error('房间已离开，消息未发送。');
  }) : undefined;
  icons(roomElement);
  $('#main').focus();
}

function resetLobby() {
  roomChat = undefined;
  voice?.destroy();
  voice = undefined;
  audienceVoice?.destroy();
  audienceVoice = undefined;
  spectator?.destroy();
  spectator = undefined;
  watchKey = undefined;
  silencedVoice = undefined;
  busyMic = false;
  currentRoom = undefined;
  standbyStatus = undefined;
  saveMatchIntent(undefined);
  pollFailures = 0;
  pollRetryAt = 0;
  lastQueuePoll = 0;
  solo = undefined;
  after = 0;
  lostSince = 0;
  pollError = undefined;
  roomVersion += 1;
  mode = 'lobby';
  roomElement.hidden = true;
  roomElement.replaceChildren();
  $('#lobby').hidden = false;
  window.speechSynthesis?.cancel();
  const url = new URL(location.href);
  if (url.searchParams.has('room')) {
    url.searchParams.delete('room');
    history.replaceState(null, '', url);
  }
  $('#main').focus();
  renderSocial();
  refreshActiveRooms();
  if (socialView === 'history') queueMicrotask(() => historyView.open());
}

async function roomRequest(action, values, files = []) {
  const payload = JSON.stringify({ id: playerId, guestKey, action, after, code: currentRoom?.code, key: watchKey, adult: preferences.adult, compact: true, ...values });
  let body = payload;
  if (files.length) {
    body = new FormData();
    body.set('payload', payload);
    for (const file of files) body.append('attachments', file);
  }
  const response = await fetch('/api/room', {
    method: 'POST',
    headers: files.length ? undefined : { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(files.length ? 120_000 : ['match', 'sync', 'standby-join', 'watch-join', 'voice-config', 'watch-config'].includes(action) ? 15_000 : 5000)
  });
  const pageMode = response.headers.get('X-Jianke-Mode');
  if (response.headers.get('X-Jianke-Site') === 'paused' ||
      (pageMode === 'archive' && !archiveMode) || (pageMode === 'encore' && archiveMode)) {
    voice?.destroy();
    audienceVoice?.destroy();
    spectator?.destroy();
    location.replace('/');
    return { state: 'closed', now: Date.now() };
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (data.code === 'moderation-banned') {
      moderationRetryAt = Math.min(data.banUntil, Date.now() + 20_000);
      if (dialog.open) dialog.close();
      if (mode !== 'lobby') resetLobby();
      const notice = $('#moderation-notice');
      notice.textContent = `此账号或网络已被封禁，预计解封时间 ${new Date(data.banUntil).toLocaleString('zh-CN')}。`;
      notice.hidden = false;
    }
    if (data.code === 'queue-conflict') {
      queueConflict = true;
      renderSocial();
    }
    throw Object.assign(new Error(data.error || '连接失败，请稍后重试。'), { status: response.status, code: data.code });
  }
  return response.json();
}

function call(action, values = {}, session = roomVersion) {
  const operation = net.then(async () => {
    await identityReady;
    if (session !== roomVersion && !['leave', 'watch-leave'].includes(action)) return;
    if (departurePending && action !== 'leave') {
      await roomRequest('leave', departurePending);
      rememberDeparture(false);
      renderSocial();
      if (session !== roomVersion && action !== 'watch-leave') return;
    }
    const started = Date.now();
    const data = await roomRequest(action, values);
    if (action === 'leave') {
      rememberDeparture(false);
      queueConflict = false;
      renderSocial();
    }
    if (session === roomVersion && !['leave', 'lobby-away', 'watch-leave', 'history'].includes(action)) {
      offset = data.now - Math.round((started + Date.now()) / 2);
      if (!['social', 'friendship', 'ice'].includes(data.state)) {
        lostSince = 0;
        pollError = undefined;
      }
      loadRoom(data);
    }
    return data;
  });
  net = operation.catch(() => {});
  return operation;
}

function loadRoom(data) {
  if (data.state === 'social') {
    $('#moderation-notice').hidden = true;
    socialLoadFailed = false;
    queueConflict = false;
    socialData = data;
    renderSocial();
    return;
  }
  if (data.state === 'friendship' || data.state === 'ice') return;
  if (data.state === 'watching') {
    if (!spectator) {
      if (dialog.open) dialog.close();
      $('#lobby').hidden = true;
      mode = 'watch';
      spectator = new WatchView($('#watch-room'), (action, values) => call(action, values), exitWatch, '旁观视角', { id: playerId, guestKey });
    }
    for (const signal of data.signals) after = Math.max(after, signal.seq);
    spectator.accept(data);
    return;
  }
  if (data.state === 'watch-closed') {
    resetLobby();
    showToast('旁观已结束或房间已关闭旁观。');
    return;
  }
  if (data.state === 'room') {
    const matched = mode === 'queue' && !!matchIntent;
    saveMatchIntent(undefined);
    if (mode !== 'online') {
      if (mode === 'lobby' && dialog.open) dialog.close();
      lastRound = undefined;
      openScreen('online');
      if (matched || standbyStatus) {
        if (preferences.sound) {
          pendingRoomChime = { session: roomVersion, matched };
          activateSound();
        }
        showToast(matched ? '匹配成功，请确认准备。' : '候补已补位，请确认准备。');
      }
      standbyStatus = undefined;
    }
    const game = data.room.game;
    if (game && !game.phases) {
      const previous = currentRoom?.game;
      game.phases = previous?.id === game.id && previous.seconds === game.seconds ? previous.phases : roundPhases(game);
    }
    if (currentRoom?.code === data.room.code && currentRoom.seconds !== data.room.seconds) {
      showToast(`时长已调整为 ${data.room.seconds / 60} 分钟`);
    }
    if (currentRoom?.standby?.revision !== data.room.standby?.revision && currentRoom?.players.length === 2 && data.room.standby?.revision) {
      showToast(data.room.standby.vacant ? '对方已退出，等待候补加入。' : '候补已加入，请重新准备。');
    } else if (currentRoom?.standby?.vacant && data.room.players.length === 2) {
      showToast('候补已加入，请重新准备。');
    }
    const voiceId = data.room.voice?.status === 'approved' ? data.room.voice.id : undefined;
    const previousVoice = currentRoom?.voice?.status === 'approved' ? currentRoom.voice.id : undefined;
    if (voiceId !== previousVoice) {
      voice?.destroy();
      voice = undefined;
      busyMic = false;
      if (voiceId && voiceId !== silencedVoice) {
        const session = roomVersion;
        const send = (action, values) => call(action, { ...values, voiceId }, session);
        const relay = new RelayVoice({ id: playerId, guestKey, code: data.room.code, voiceId, send, onChange: render });
        voice = new RoomVoice($('#remote-audio'), send, render, { relay });
      }
    }
    currentRoom = data.room;
    roomChat?.accept(currentRoom.chat, currentRoom.controller, { visible: currentRoom.players.length === 2,
      public: currentRoom.audience.open, partnership: currentRoom.standby?.revision ?? 0 });
    const watchSignals = data.watchSignals ?? [];
    for (const signal of [...data.signals, ...watchSignals]) after = Math.max(after, signal.seq);
    voice?.accept(currentRoom, data.signals);
    const session = roomVersion;
    audienceVoice ??= new AudienceVoice((action, values) => call(action, { ...values, voiceId: currentRoom?.voice?.id }, session),
      () => voice?.stream?.getAudioTracks()[0], { id: playerId, guestKey },
      () => voice?.relay?.context?.state === 'running' ? voice.relay.context : audioContext?.state === 'running' ? audioContext : voice?.relay?.context);
    audienceVoice.accept(currentRoom, watchSignals);
  } else if (data.state === 'queued') {
    standbyStatus = data.standby;
    if (mode !== 'queue') openScreen('queue');
    roomElement.classList.toggle('standby-queue', !!standbyStatus);
    if (standbyStatus) {
      roomChat ??= new RoomChat(roomElement.querySelector('.room-chat'));
      const chat = standbyStatus.chat;
      roomChat.accept(chat?.messages, chat?.controller);
      roomChat.empty.textContent = chat ? '暂无公开消息。' : '房间双方开放观战后，候补可在这里查看公开消息。';
    } else if (roomChat) {
      roomChat.accept([], 0, { visible: false });
    }
  } else if (data.state === 'closed' || (data.state === 'idle' && mode !== 'lobby')) {
    rememberReport(data.recentReport ?? currentRoom?.report);
    const wasStandby = !!standbyStatus;
    lastRound = data.lastRound;
    resetLobby();
    showToast(data.state === 'closed' ? '房间已结束，已返回大厅。' : wasStandby ? '候补队列已结束。' : '匹配已结束，请重新开始。');
    return;
  }
  render();
}

function enter(action, values, form) {
  return submitRoomAction(action, { ...lobbyValues(), ...values }, form);
}

async function joinWithRetry(action, values, isCurrent, onRetry) {
  const session = roomVersion;
  const delays = [0, 350, 1100];
  for (const [attempt, delay] of delays.entries()) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 250));
    if (session !== roomVersion || !isCurrent()) return;
    try {
      return await call(action, values, session);
    } catch (error) {
      const retryable = error.status === 429 || error.status >= 500 || ['TypeError', 'TimeoutError'].includes(error.name);
      if (!retryable || attempt === delays.length - 1) throw error;
      onRetry();
    }
  }
}

async function submitRoomAction(action, values, form) {
  activateSound();
  if (action === 'match') {
    saveMatchIntent({ ...values, matchId: randomClientId() });
    dialog.close();
    openScreen('queue');
    render();
    pollRoom(true);
    return;
  }
  const controls = form ? [...form.querySelectorAll('button')] : [];
  controls.forEach(control => { control.disabled = true; });
  try {
    await call(action, values);
    dialog.close();
  } catch (error) {
    const message = ['TimeoutError', 'AbortError'].includes(error.name) ? '连接超时，请重试。' : error.message;
    if (form) {
      const output = form.querySelector('.form-error');
      output.hidden = false;
      output.textContent = message;
    } else showToast(message);
  } finally {
    controls.forEach(control => { control.disabled = false; });
  }
}

function startSolo(seconds, difficulty) {
  activateSound();
  if (mode === 'lobby' && preferences.adult) call('lobby-away').catch(() => {});
  if (mode !== 'solo') openScreen('solo');
  solo = { seconds, difficulty, id: crypto.randomUUID?.() ?? String(Date.now()), startAt: Date.now() + 2500, pausedAt: null, phases: plan(seconds, difficulty), marks: [[]] };
  dialog.close();
  render();
}

function end() {
  if (mode === 'watch') return exitWatch();
  if (mode === 'solo' && solo) recordPractice(solo, getProgress(solo, Date.now()), Date.now());
  const online = mode === 'online' || mode === 'queue';
  const code = currentRoom?.code;
  const game = currentRoom?.game;
  if (currentRoom?.report) rememberReport(currentRoom.report);
  if (game && getProgress(game, Date.now() + offset).done) {
    lastRound = { code, round: game.id, nickname: currentRoom.players[1 - currentRoom.me]?.nickname, expires: Date.now() + offset + 30_000 };
  }
  if (online) rememberDeparture({ code, matchId: matchIntent?.matchId });
  resetLobby();
  if (online) call('leave', departurePending).catch(() => {});
}

function exitWatch() {
  const key = watchKey;
  resetLobby();
  return call('watch-leave', { key }).catch(() => {});
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, '0');
  const remainder = String(seconds % 60).padStart(2, '0');
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${minutes}:${remainder}` : `${minutes}:${remainder}`;
}

function stageInfo(now, game, room) {
  const ready = room?.players[room.me]?.ready;
  const controller = room && room.me === room.controller;
  const count = game?.marks[room?.me ?? 0]?.length ?? 0;
  const readyButton = label => button('ready', ready ? '取消准备' : label, ready ? 'close' : 'check', ready ? 'outline' : 'primary');
  const preferOpen = room?.audience.preferOpen;
  const watchOption = room && `<div class="stage-watch-option">
    <label><input id="round-watch-open" type="checkbox"${preferOpen ? ' checked' : ''}${ready ? ' disabled' : ''}> 允许访客观战、查看预设反馈和公屏新消息</label>
    <small>双方允许后公开对局，语音旁听需单独开启。</small></div>`;
  const durationButton = button('duration', '调整时长', 'clock');
  const roundLength = room ? `每局 ${room.seconds / 60} 分钟` : '';
  const maxStrength = normalizeRoundLimits(room?.limits).maxIntensity;
  const strengthLabel = maxStrength ? `强度最高 ${maxStrength} 档` : '关闭强度档位';
  if (lostSince && Date.now() - lostSince > 4500) {
    const full = pollError === 'queue-full';
    const busy = pollError === 'busy';
    return { key: pollError, title: full ? '匹配队列已满' : busy ? '大厅繁忙' : '连接暂时中断',
      detail: full ? '有空位时会按原偏好自动排队。' : mode === 'queue' && matchIntent ? '恢复连接后会按原偏好继续匹配。' : '恢复连接后会同步房间进度。',
      symbol: 'wave', controls: button('retry-room', '立即重试') };
  }
  if (mode === 'queue' && standbyStatus) {
    const { nickname, position, role } = standbyStatus;
    return { key: `standby-${position}-${nickname}-${role}`, title: `候补第 ${position} 位`,
      detail: `等待与 ${escapeHtml(nickname || '匿名玩家')} 对局。有空位时将自动补位。`, symbol: 'users', loading: true,
      badges: [roles[role]], controls: button('end', '退出候补') };
  }
  if (mode === 'queue') return { key: 'queue', title: '正在匹配', detail: '找到角色互补、且符合双方偏好的玩家后将进入房间。', symbol: 'users', loading: true, controls: button('end', '取消匹配') };
  if (room?.standby?.vacant) return { key: `vacant-${room.standby.open}`, title: '等待新的搭档',
    detail: room.standby.open ? '有候补后会自动加入。双方准备好再继续。' : '重新开放候补即可接收新的搭档。', symbol: 'users', loading: true,
    controls: room.standby.open ? '' : button('standby-open', '开放候补', 'users') };
  if (room?.players.length === 1) return { key: `invite-${room.seconds}`, title: '等待好友加入', detail: '发送房间码或邀请链接，一起进入游戏。', symbol: 'key', loading: true,
    badges: [roundLength], controls: button('copy', '复制邀请链接', 'copy', 'primary') + durationButton };
  if (!game) {
    return { key: `ready-${ready}-${room.seconds}-${maxStrength}-${preferOpen}`, title: room.kind === 'friend' ? '对方已加入' : '已匹配到玩家',
      detail: controller ? '你是领拍者。双方准备后，你可以发送节奏指令。' : '你是跟拍者。双方准备后，跟随对方发出的节奏。',
      symbol: 'users', badges: [roundLength, strengthLabel], watchOption, controls: readyButton('我准备好了') + durationButton };
  }
  const progress = getProgress(game, now);
  if (progress.done) {
    const peer = room ? game.marks[1 - room.me].length : 0;
    return {
      key: `result-${game.id}-${count}-${peer}-${ready}-${room?.seconds}-${sentForRound === game.id}-${preferOpen}-${!!room?.report}`,
      title: game.finishedAt != null ? '本局已结束' : '挑战完成', detail: '本轮节奏结束，可以再来一局。', symbol: 'trophy',
      badges: [`我的停拍 ${count} 次`, ...(room ? [`对方停拍 ${peer} 次`, `下局 ${room.seconds / 60} 分钟`] : [])],
      watchOption,
      controls: (room ? readyButton('再玩一局') : button('replay', '再练一局', 'play', 'primary')) + durationButton +
        (room ? button('add-friend', sentForRound === game.id ? '已处理' : '加好友', 'user', 'outline', sentForRound === game.id) : '') +
        (room?.report ? button('report-result', '举报对方') : '')
    };
  }
  if (game.pausedAt) {
    return {
      key: `paused-${ready}-${preferOpen}`, title: '已暂停', detail: room ? '双方重新准备后继续本局。' : '准备好后继续本轮练习。', symbol: 'pause', watchOption,
      controls: room ? readyButton('准备继续') + button('finish-round', '结束本局') : button('pause', '继续练习', 'play', 'primary')
    };
  }
  const countdown = (game.resumeAt ?? game.startAt) - now;
  if (countdown > 0) {
    const seconds = Math.ceil(countdown / 1000);
    return { key: `countdown-${seconds}`, title: `${seconds}`, detail: game.resumeAt ? '即将继续' : '即将开始', symbol: 'clock' };
  }
  const phase = progress.phase;
  const cue = cues[phase.kind];
  const bpm = phase.bpm ?? cue.bpm;
  const hold = phase.until == null ? 0 : Math.ceil((phase.until - progress.elapsed) / 1000);
  const marked = game.marks[room?.me ?? 0].includes(progress.index);
  const partnerCount = controller ? game.marks[1 - room.me].length : 0;
  const showMark = phase.kind === 'stop' && !(controller && progress.live);
  return {
    key: `${game.id}-${progress.index}-${count}-${partnerCount}-${hold}-${game.intensity}-${game.focus}`, cue: phase.kind, bpm,
    title: phase.bpm != null ? tempos[phase.bpm] ?? cue.title : cue.title,
    detail: !showMark && phase.kind === 'stop' ? '等待对方记录停拍。' : cue.detail, symbol: cue.icon,
    badges: [controller ? `对方已停拍 ${partnerCount} 次` : `停拍记录 ${count} 次`, ...(bpm ? [`${bpm} BPM`] : []),
      ...(hold ? [`停拍还剩 ${hold} 秒`] : []), ...(game.intensity ? [`强度 ${game.intensity}/5`] : []),
      ...(game.focus && game.focus !== 'free' && focusOptions[game.focus] ? [`焦点 · ${focusOptions[game.focus]}`] : [])],
    controls: (showMark ? button('mark', marked ? '已记录' : '我已停拍', 'check', 'primary', marked) : '') +
      button('pause', room ? '暂停双方' : '暂停练习', 'pause') + (room ? button('finish-round', '结束本局') : '')
  };
}

function render() {
  if (mode === 'lobby' || mode === 'watch') return;
  const room = currentRoom;
  const practiceMode = mode === 'solo';
  const game = practiceMode ? solo : room?.game;
  const now = Date.now() + (practiceMode ? 0 : offset);
  const heading = practiceMode ? '单人练习' : mode === 'queue' ? (standbyStatus ? '候补队列' : '随机匹配') : room?.kind === 'friend' ? '好友房间' : '双人挑战';
  const title = roomElement.querySelector('h1');
  if (title.textContent !== heading) title.textContent = heading;
  const side = roomElement.querySelector('.room-side');
  side.hidden = !room;
  roomElement.querySelector('.room-grid').classList.toggle('practice', !room);
  const endButton = roomElement.querySelector('.room-head [data-action="end"]');
  const endLabel = practiceMode ? '结束练习' : mode === 'queue' ? (standbyStatus ? '退出候补' : '取消匹配') : '退出房间';
  if (endButton.textContent !== endLabel) endButton.textContent = endLabel;
  const soundControl = roomElement.querySelector('[data-action="sound-toggle"]');
  const soundLabel = preferences.sound && audioContext?.state === 'running' ? '节拍声已开' : '开启节拍声';
  if (soundControl.textContent !== soundLabel) soundControl.textContent = soundLabel;
  soundControl.setAttribute('aria-pressed', String(soundLabel === '节拍声已开'));

  const stage = roomElement.querySelector('.room-stage');
  const info = stageInfo(now, game, room);
  const progress = getProgress(game, now);
  const compact = !!(room?.players.length === 2 && game && !progress.done && (info.cue || info.key.startsWith('paused-')));
  if (!compact) roomElement.removeAttribute('data-room-panel');
  if (!info.cue && roomElement.dataset.roomPanel === 'more') roomElement.removeAttribute('data-room-panel');
  roomElement.classList.toggle('compact-round', compact);
  roomElement.querySelector('[data-panel="more"]').hidden = !info.cue;
  const voiceTool = roomElement.querySelector('[data-panel="voice"]');
  const incomingVoice = room?.voice?.status === 'pending' && room.voice.requestedBy !== room.me;
  const voiceLabel = incomingVoice ? '语音邀请' : '语音';
  if (voiceTool.textContent !== voiceLabel) voiceTool.textContent = voiceLabel;
  voiceTool.classList.toggle('primary', incomingVoice);
  for (const tab of roomElement.querySelectorAll('[data-panel]')) {
    const expanded = String(compact && roomElement.dataset.roomPanel === tab.dataset.panel);
    if (tab.getAttribute('aria-expanded') !== expanded) tab.setAttribute('aria-expanded', expanded);
  }
  if (practiceMode && progress.done) recordPractice(game, progress, now);
  const timed = game && !progress.done;
  const clock = stage.querySelector('.time-label');
  clock.hidden = !timed;
  const time = timed ? formatTime(progress.remaining) : '';
  if (clock.textContent !== time) clock.textContent = time;
  stage.querySelector('.progress').hidden = !game;
  stage.querySelector('.progress span').style.width = game ? `${Math.min(100, Math.max(0, progress.elapsed / game.seconds / 10))}%` : '0';
  if (stageKey !== info.key) {
    stageKey = info.key;
    stage.dataset.cue = info.cue ?? '';
    const body = stage.querySelector('.stage-content');
    body.innerHTML = `<span class="orb${info.loading ? ' loading-orb' : ''}" data-icon="${info.symbol}"></span>
      <h2>${info.title}</h2><p>${info.detail}</p>
      ${info.badges?.length ? `<div class="stage-badges">${info.badges.map(badge => `<span>${badge}</span>`).join('')}</div>` : ''}
      ${info.watchOption || ''}
      ${info.controls ? `<div class="stage-controls">${info.controls}</div>` : ''}`;
    icons(body);
  }
  if (room) {
    renderVoice(room);
    renderSide(room, side);
  }
  const feedback = roomElement.querySelector('.peer-feedback');
  let feedbackText = '';
  if (room?.players.length === 2 && game && !progress.done) {
    const controller = room.me === room.controller;
    const message = controller ? receiverReplies[game.reply?.key] : (game.hint?.text ?? coachHints[game.hint?.key]);
    if (message) feedbackText = `${controller ? '跟拍者反馈' : '领拍者提示'} · ${message}`;
  }
  feedback.hidden = !feedbackText;
  if (feedback.textContent !== feedbackText) feedback.textContent = feedbackText;
  renderControls(room, game, info, progress);

  const cue = info.cue ? cues[info.cue] : null;
  const soundKey = cue ? `${game.id}-${progress.index}` : info.key.startsWith('result-') ? `result-${game.id}` : info.key;
  if (soundKey !== heard) {
    heard = soundKey;
    lastBeat = -1;
    if (cue) {
      speak(info.title);
      if (!info.bpm) beat(360, .14, .19);
    } else if (info.key.startsWith('countdown-')) {
      beat(550, .10, .1);
    } else if (info.key.startsWith('result-')) {
      speak(info.title);
      beat(700, .11, .18);
    } else if (info.key.startsWith('paused-')) window.speechSynthesis?.cancel();
  }
  if (info.bpm && Date.now() > mutedUntil) {
    const beatNumber = Math.floor((progress.elapsed - progress.phaseStart) * info.bpm / 60_000);
    if (lastBeat !== beatNumber && beat(info.bpm > 70 ? 950 : 720)) lastBeat = beatNumber;
  }
}

function roundButton(kind, value, label, pressed, disabled = false) {
  return `<button type="button" class="button outline cue-option" data-action="round-input" data-kind="${kind}" data-value="${escapeHtml(String(value))}"${pressed == null ? '' : ` aria-pressed="${pressed}"`}${disabled ? ' disabled' : ''}>${escapeHtml(label)}</button>`;
}

function roundSelect(kind, label, entries, selected) {
  const options = entries.map(([value, text]) => `<option value="${value}"${String(value) === String(selected) ? ' selected' : ''}>${text}</option>`).join('');
  return `<label class="round-select">${label}<select data-round-kind="${kind}">${options}</select></label>`;
}

const defaultReplies = ['slower', 'gentler', 'limit', 'rest'];
const replyGroups = [
  ['节奏', ['faster', 'slower', 'same', 'rhythm', 'hold', 'repeat-pace']],
  ['强度与动作', ['gentler', 'stronger', 'change', 'keep-action', 'ask-first']],
  ['现在的感受', ['comfortable', 'ready', 'limit', 'feeling-better', 'feel-unsure']],
  ['想请对方做什么', ['rest', 'need-time', 'check-in', 'boundary']],
  ['想告诉对方', ['appreciate-check', 'keep-communicating']]
];

function favoriteReplies() {
  try {
    const saved = JSON.parse(localStorage.getItem('jianke-favorite-replies'));
    if (Array.isArray(saved)) return saved.filter(key => key !== 'uncomfortable' && Object.hasOwn(receiverReplies, key)).slice(0, 5);
  } catch {}
  return defaultReplies;
}

function editReplies() {
  const favorites = favoriteReplies();
  popup('设置常用回馈', `<form id="reply-settings">
    <p>选最多 5 条放在对局面板。暂停按钮始终显示。</p>
    ${replyGroups.map(([group, keys]) => `<fieldset><legend>${group}</legend><div class="reply-options">
      ${keys.map(key => `<label class="toggle"><input type="checkbox" name="reply" value="${key}"${favorites.includes(key) ? ' checked' : ''}>${receiverReplies[key]}</label>`).join('')}
    </div></fieldset>`).join('')}
    <p class="form-error" role="status" hidden></p>
    <div class="dialog-actions">${button('reset-replies', '恢复默认')}<button type="submit" class="button primary">保存</button></div>
  </form>`);
}

function customHints() {
  try {
    const saved = JSON.parse(localStorage.getItem('jianke-custom-hints'));
    if (Array.isArray(saved)) return saved.map(cleanCustomHint).filter(text => text && text.length <= customHintLimit).slice(0, customHintCount);
  } catch {}
  return [];
}

function editCustomHints() {
  popup('自定义指令', `<form id="custom-hint-settings">
    <label class="field">每行一句，最多 ${customHintCount} 句，每句最多 ${customHintLimit} 字
      <textarea name="hints" rows="7" maxlength="${customHintCount * (customHintLimit + 1)}">${escapeHtml(customHints().join('\n'))}</textarea>
    </label>
    <p class="form-error" role="status" hidden></p>
    <div class="dialog-actions">${button('close', '取消')}<button type="submit" class="button primary">保存指令</button></div>
  </form>`);
}
function mobilePromptPages(groups, kind, labels) {
  return `<div class="mobile-prompt-pages" tabindex="0" role="region" aria-label="快捷语，左右滑动切换分类">
    ${groups.filter(([, keys]) => keys.length).map(([title, keys]) => `<section class="mobile-prompt-page" aria-label="${title}">
      <h3>${title}</h3><div class="mobile-prompt-grid">
        ${keys.map(key => roundButton(kind, key, labels[key])).join('')}
      </div></section>`).join('')}</div>`;
}

const tempoBands = Object.keys(tempos).map(Number);

function mobileController(info, game, progress, limit) {
  const intensity = Math.min(game.intensity ?? 0, limit);
  const sliders = preferences.controlLayout === 'sliders';
  const tempoIndex = Math.max(0, tempoBands.indexOf(info.bpm || 75));
  const stop = progress.live?.kind === 'stop';
  const cue = (key, label, pressed) => `<button type="button" class="button outline cue-option" data-action="cue" data-cue="${key}" aria-pressed="${pressed}">${label}</button>`;
  const speed = (direction, label, fallback, edge) => info.bpm
    ? roundButton('tempo-adjust', direction, label, null, info.bpm === edge)
    : roundButton('tempo', fallback, label);
  return `<section class="mobile-controller" aria-label="速度与强度">
    <div class="mobile-controller-head">
      <div class="controller-layout-options" role="group" aria-label="面板样式">
        <button type="button" class="button outline" data-action="control-layout" data-layout="dial" aria-pressed="${!sliders}">圆盘</button>
        <button type="button" class="button outline" data-action="control-layout" data-layout="sliders" aria-pressed="${sliders}">滑条</button>
      </div>
      ${cue('auto', '自动节奏', !progress.live)}
    </div>
    ${sliders ? `<div class="controller-sliders">
      <label>速度 <output>${info.bpm ? info.bpm + ' BPM' : '停拍中'}</output>
        <input type="range" min="0" max="${tempoBands.length - 1}" value="${tempoIndex}" data-round-kind="tempo" data-control-range>
      </label>
      <label>强度 <output>${limit ? intensity + ' / ' + limit + ' 档' : '已关闭'}</output>
        <input type="range" min="0" max="${limit}" value="${intensity}" data-round-kind="intensity" data-control-range ${limit ? '' : 'disabled'}>
      </label>
      ${cue('stop', '停拍', stop)}
    </div>` : `<div class="controller-dial" role="group" aria-label="圆盘控制">
      <div class="dial-faster">${speed('faster', '调快', 75, 210)}</div>
      <div class="dial-lighter">${roundButton('intensity-adjust', 'lighter', '调轻', null, !intensity)}</div>
      <div class="dial-stop">${cue('stop', '停拍', stop)}</div>
      <div class="dial-heavier">${roundButton('intensity-adjust', 'heavier', '调重', null, intensity >= limit)}</div>
      <div class="dial-slower">${speed('slower', '调慢', 55, 40)}</div>
    </div>
    <p class="dial-reading">${info.bpm ? info.bpm + ' BPM' : '停拍中'} · ${limit ? '强度 ' + intensity + ' / ' + limit + ' 档' : '强度已关闭'}</p>`}
  </section>`;
}

function renderControls(room, game, info, progress) {
  const dock = roomElement.querySelector('.control-dock');
  const controller = room?.me === room?.controller;
  const playing = !!info.cue;
  const visible = room?.players.length === 2 && (playing || info.key.startsWith('paused-'));
  dock.hidden = !visible;
  if (!visible) return;
  if (dock.querySelector('[data-control-range]:active')) return;
  const focusedRange = dock.contains(document.activeElement) && document.activeElement.matches('[data-control-range]')
    ? document.activeElement.dataset.roundKind : undefined;
  const key = JSON.stringify([game.id, playing, preferences.controlLayout, info.bpm, progress.live?.id, game.intensity, game.focus, game.hint, game.reply, game.limit, game.extension, game.extensionResult, room.limits]);
  if (controlKey === key) return;
  controlKey = key;
  const expanded = dock.querySelector('details')?.open ? ' open' : '';
  const promptScroll = dock.querySelector('.mobile-prompt-pages')?.scrollLeft ?? 0;
  const own = controller ? (game.hint?.text ?? coachHints[game.hint?.key]) : receiverReplies[game.reply?.key];
  const status = [controller && game.limit && `对方接近极限程度 ${game.limit}/5`, own && `已发送：${own}`].filter(Boolean);
  if (game.extensionResult) status.push(game.extensionResult.accepted ? `双方已确认加时 ${game.extensionResult.seconds} 秒` : '对方选择维持原时长');
  const extension = game.extension && playing ? `<div class="round-extension"><span>${controller ? '等待对方确认' : '对方提议'} · 加时 ${game.extension.seconds} 秒</span>
    ${controller ? '' : roundButton('extension-response', 'accept', '同意') + roundButton('extension-response', 'decline', '保持原时长')}</div>` : '';
  const levels = Array.from({ length: maxIntensity }, (_, i) => [i + 1, `${i + 1} 档`]);
  const limits = normalizeRoundLimits(room.limits);
  const intensityLevels = levels.slice(0, limits.maxIntensity);
  const availableExtensions = extensions.filter(seconds => withinRoundLimits(game.seconds + seconds, limits));
  const custom = customHints();
  const customButtons = custom.map(text => roundButton('custom-hint', text, text)).join('');
  const controllerPanel = `<div class="dock-actions controller-desktop-controls" role="group" aria-label="常用指令">
    ${roundButton('tempo-adjust', 'slower', '慢一档', null, !info.bpm || info.bpm <= 40)}
    ${roundButton('tempo-adjust', 'hold', '保持节拍', null, !info.bpm)}
    ${roundButton('tempo-adjust', 'faster', '快一档', null, !info.bpm || info.bpm >= 210)}
    <span class="desktop-round-action">${button('pause', '先休息一下', 'pause')}</span>
    <span class="desktop-round-action">${roundButton('hint', 'check', '确认状态')}</span>
    </div>
    ${mobileController(info, game, progress, limits.maxIntensity)}
    ${mobilePromptPages(coachHintGroups.flatMap(([title, keys]) => Array.from({ length: Math.ceil(keys.length / 4) },
      (_, index) => [index ? title + ' · 更多' : title, keys.slice(index * 4, index * 4 + 4)])), 'hint', coachHints)}
    <div class="controller-custom-hints">
      ${custom.length ? `<div class="custom-hint-rail" aria-label="我的指令">${customButtons}</div>` : ''}
      ${button('edit-custom-hints', '自定义指令')}
    </div>
    <div class="round-more" id="room-more" tabindex="-1" aria-label="进阶控制"><div class="dock-actions">
    ${Object.keys(tempos).map(bpm => roundButton('tempo', bpm, `${bpm} BPM`, progress.live?.bpm === Number(bpm))).join('')}
    <button class="button outline cue-option" data-action="cue" data-cue="stop" aria-pressed="${progress.live?.kind === 'stop'}">停拍</button>
    <button class="button outline cue-option" data-action="cue" data-cue="auto" aria-pressed="${!progress.live}">自动</button></div>
    <details class="round-details"${expanded}><summary>强度、提示与加时</summary>
      <div class="round-fields">${roundSelect('intensity', intensityLevels.length ? `强度（最高 ${limits.maxIntensity} 档）` : '强度（已关闭）', [[0, '未设置'], ...intensityLevels], game.intensity ?? 0)}${roundSelect('focus', '动作焦点', Object.entries(focusOptions), game.focus ?? 'free')}</div>
      <div class="round-action-group"><strong>定时停拍</strong><div class="dock-actions">${shortStops.map(seconds => roundButton('stop-for', seconds, `${seconds} 秒`)).join('')}</div></div>
      ${coachHintGroups.map(([title, keys]) => `<div class="round-action-group"><strong>${title}</strong><div class="dock-actions">
        ${keys.map(key => roundButton('hint', key, coachHints[key])).join('')}</div></div>`).join('')}
      ${!game.extension && availableExtensions.length ? `<div class="round-action-group"><strong>申请加时</strong><div class="dock-actions">${availableExtensions.map(seconds => roundButton('extend', seconds, `+${seconds} 秒`)).join('')}</div></div>` : ''}
    </details></div>`;
  const replies = keys => keys.map(key => roundButton('reply', key, receiverReplies[key])).join('');
  const receiverPanel = playing ? `<div class="dock-actions">${replies(['uncomfortable'])}
      <span class="desktop-round-action">${replies(favoriteReplies())}</span>
      ${button('edit-replies', '设置常用回馈')}</div>
    ${mobilePromptPages([['常用回馈', favoriteReplies()], ...replyGroups], 'reply', receiverReplies)}
    <div class="round-more" id="room-more" tabindex="-1" aria-label="进阶回馈">
    <details class="round-details"${expanded}><summary>更多回馈</summary>
      <div class="round-fields">${roundSelect('limit', '接近极限程度', [[0, '未设置'], ...levels], game.limit ?? 0)}</div>
      ${replyGroups.map(([group, keys]) => `<div class="round-action-group"><strong>${group}</strong><div class="dock-actions">${replies(keys)}</div></div>`).join('')}
    </details></div>` : `<div class="dock-actions">${replies(['more-time', 'recovered', 'change', 'check-in'])}</div>`;
  dock.innerHTML = `<div class="dock-heading"><h2>${controller ? '对局控制' : '向对方回馈'}</h2><span>${playing ? (progress.live ? '手动节奏' : '自动节奏') : '已暂停'}</span></div>
    ${status.length ? `<p class="round-status" role="status">${status.map(escapeHtml).join(' · ')}</p>` : ''}${extension}
    ${controller ? (playing ? controllerPanel : '') : receiverPanel}`;
  const pages = dock.querySelector('.mobile-prompt-pages');
  if (pages) pages.scrollLeft = promptScroll;
  if (focusedRange) dock.querySelector(`[data-control-range][data-round-kind="${focusedRange}"]`)?.focus({ preventScroll: true });
}

function voicePanel(room) {
  const consent = room.voice;
  if (room.players.length < 2) return ['双方到齐后可以申请语音。', ''];
  if (voice) {
    const micOn = !!voice.stream;
    const output = voice.relayActive ? voice.relay : voice;
    const blocked = output.audioBlocked && !output.muted;
    const status = voice.enablingRelay ? '正在启用兼容语音…' : voice.relayActive || (voice.relayRequested && !voice.directConnected)
      ? voice.relay.status : voice.status;
    return [voice.micStatus || status,
      button('mic', busyMic ? '正在处理…' : micOn ? '关闭麦克风' : '开启麦克风', micOn ? 'mic' : 'micOff', micOn ? 'primary' : 'outline', busyMic) +
      button('listen', blocked ? '播放对方语音' : output.muted ? '取消静音' : '静音对方', output.muted ? 'volumeOff' : 'volume') +
      (!voice.relayActive && !voice.directConnected && room.players.some(player => player.mic) ? button('retry-voice', '重试直连', 'wave') : '') +
      (!voice.relayRequested ? button('voice-fallback', '使用兼容语音', '', 'outline', voice.enablingRelay) : '') + button('voice-close', '结束语音', 'close')];
  }
  if (consent?.status === 'approved') return ['本机语音已停止。', button('voice-close', '结束语音', 'close')];
  if (consent?.status === 'pending') {
    return consent.requestedBy === room.me
      ? ['等待对方同意语音。', button('voice-close', '撤回申请', 'close')]
      : ['同意后，你仍可选择是否开麦。', button('voice-accept', '同意语音', 'check', 'primary') + button('voice-decline', '拒绝')];
  }
  const status = consent?.status === 'declined' ? '语音申请已被拒绝。' : '对方同意后，双方可各自开启麦克风。';
  return [status, button('voice-request', '申请语音', 'mic')];
}

function renderVoice(room) {
  const panel = roomElement.querySelector('.room-voice');
  panel.hidden = false;
  const incoming = room.voice?.status === 'pending' && room.voice.requestedBy !== room.me;
  const sharing = room.audience;
  panel.toggleAttribute('data-incoming', incoming);
  panel.toggleAttribute('data-public-audio', sharing?.publicAudio === true);
  const title = panel.querySelector('h2');
  const label = incoming ? '对方申请开启语音' : sharing?.publicAudio ? '房间语音 · 公开旁听中' : '房间语音';
  if (title.textContent !== label) title.textContent = label;
  const [status, controls] = voicePanel(room);
  const message = panel.querySelector('p');
  if (message.textContent !== status) message.textContent = status;
  const preference = panel.querySelector('.room-voice-preference');
  const preferred = room.voicePreference;
  const text = preferred && preferred !== 'any' ? `开麦偏好 · ${voicePreferences[preferred]}` : '';
  preference.hidden = !text;
  if (preference.textContent !== text) preference.textContent = text;
  updateContent(panel.querySelector('.voice-actions'), controls);
  const audience = panel.querySelector('.voice-audience');
  audience.hidden = room.players.length !== 2;
  if (audience.hidden) return;
  const note = sharing.publicAudio ? '旁听已开启，访客进入观战即可听到开麦语音。'
    : '双方都允许，并开启公开观战和房间语音后，访客进房即可听。任一方选择禁止，旁听会停止。';
  updateContent(audience, `<div class="public-audio-settings" role="group" aria-label="旁听设置">
    <p>${note}</p>
    <button type="button" class="button ${sharing.audioOptedIn ? 'primary' : 'outline'}" data-action="watch-audio-allow" aria-pressed="${sharing.audioOptedIn}">允许旁听申请</button>
    <button type="button" class="button ${sharing.audioOptedIn ? 'outline' : 'primary'}" data-action="watch-audio-block" aria-pressed="${!sharing.audioOptedIn}">禁止旁听申请</button></div>`);
}

function renderSide(room, side) {
  const previous = room.previousRound;
  const canAddPrevious = previous && previous.expires > Date.now() + offset && sentForRound !== previous.round;
  const key = JSON.stringify([room.players, room.controller, room.waitingRole, room.seconds, room.limits, room.standby, room.audience, previous, canAddPrevious, !!room.report]);
  if (sideKey === key) return;
  sideKey = key;
  const players = room.players.map((player, index) => {
    const me = index === room.me;
    const name = player.nickname || (me ? '游客' : '匿名玩家');
    const role = room.players.length < 2 ? roles[room.waitingRole] : roles[index === room.controller ? 'controller' : 'receiver'];
    return `<div class="participant"><span class="avatar" data-icon="user"></span><div>
      <strong>${escapeHtml(name)}${me ? '（我）' : ''}</strong><small>${role} · ${player.ready ? '已准备' : '在房间内'}</small>
      ${player.address ? `<small>希望称呼 ${escapeHtml(player.address)}</small>` : ''}</div>
      <span class="mic-status${player.mic ? ' enabled' : ''}" aria-label="${player.mic ? '麦克风开' : '麦克风关'}" data-icon="${player.mic ? 'mic' : 'micOff'}"></span></div>`;
  }).join('');
  side.innerHTML = `<h2>房间成员 <small>${room.players.length}/2</small></h2>${players}
    ${room.report ? button('report-room', '举报对方') : ''}
    ${room.players.length === 1 && !room.standby?.vacant ? `<div class="participant"><span class="avatar" data-icon="users"></span><div><strong>等待好友</strong><small>分享邀请链接即可加入</small></div></div>` : ''}
    <p class="room-limits">可接受范围 · ${roundLimitsSummary(room.limits)}</p>
    ${room.kind === 'friend' ? `<div class="invite-info"><h2>房间邀请</h2><span class="room-code">${room.code}</span>
      <div class="stage-badges room-tags"><span>${room.seconds / 60} 分钟</span><span>${paces[room.difficulty].label}</span></div></div>` : ''}
    ${room.standby ? `<section class="standby-panel" aria-label="候补队列"><h2>候补队列</h2>
      <p>${room.standby.open ? `${room.standby.waiting} 人等待与你对局。` : '开放后，其他玩家可以在大厅排队等你。'}</p>
      ${button('standby-open', room.standby.open ? '关闭候补' : '开放候补', 'users')}</section>` : ''}
    ${room.players.length === 2 && room.audience ? `<section class="standby-panel"><h2>公开观战</h2>
      <p>${room.audience.open ? `旁观 ${room.audience.viewerCount ?? room.audience.viewers.length}/${room.audience.viewerLimit} 人 · ${room.audience.publicAudio ? '已公开语音' : '语音旁听可单独开启'}` : '双方都允许后，对局会列在首页。'}</p>
      ${button('watch-open', room.audience.preferOpen ? '关闭公开观战' : '开放观战、反馈和公屏', 'users')}
      </section>` : ''}
    ${canAddPrevious ? `<section class="standby-panel"><p>刚与 ${escapeHtml(previous.nickname || '匿名玩家')} 完成一局。</p>${button('add-previous-friend', '加好友', 'user')}</section>` : ''}`;
  icons(side);
}

async function copyInvite() {
  const link = new URL(location.pathname, location.origin);
  link.searchParams.set('room', currentRoom.code);
  try {
    await navigator.clipboard.writeText(link.href);
    showToast('已复制邀请链接');
  } catch {
    popup('分享邀请', `<p>复制链接或把房间码 ${currentRoom.code} 发给好友。</p>
      <label class="field">邀请链接<input readonly value="${escapeHtml(link.href)}"></label>
      <div class="dialog-actions">${button('close', '完成', 'check', 'primary')}</div>`);
    dialog.querySelector('input').select();
  }
}

function togglePause() {
  if (mode === 'online') return call('pause');
  if (!solo || getProgress(solo, Date.now()).done) return;
  const now = Date.now();
  if (solo.pausedAt) {
    solo.startAt += now + 2500 - solo.pausedAt;
    solo.pausedAt = null;
    solo.resumeAt = now + 2500;
  } else if (now >= (solo.resumeAt ?? solo.startAt)) solo.pausedAt = now;
  render();
}

function markStop() {
  const game = mode === 'solo' ? solo : currentRoom?.game;
  const index = getProgress(game, Date.now() + (mode === 'solo' ? 0 : offset))?.index;
  if (mode === 'online') return call('mark', { index, round: game.id });
  if (game.phases[index]?.kind === 'stop' && !game.marks[0].includes(index)) {
    game.marks[0].push(index);
    render();
  }
}

function sendRoundInput(kind, value) {
  const game = currentRoom?.game;
  if (!game) return;
  return call('interaction', { kind, value: kind !== 'custom-hint' && /^\d+$/.test(value) ? Number(value) : value, round: game.id, request: game.extension?.id });
}

const actions = {
  lobby: () => { if (mode !== 'lobby') end(); },
  end,
  close: () => dialog.close(),
  guide,
  privacy,
  settings,
  friend: () => confirmAge(() => friend()),
  'online-players': () => confirmAge(() => openSocial('online')),
  'room-list': () => openSocial('rooms'),
  'open-history': () => confirmAge(() => openSocial('history')),
  'my-friends': () => confirmAge(() => openSocial('friends')),
  'friend-chat': target => openFriendChat(target.dataset.target),
  'report-online': target => {
    const id = target.dataset.target;
    const player = [...(socialData?.players ?? []), ...(socialData?.standby ?? [])].find(entry => entry.id === id);
    if (player) openReport('online', id, { nickname: player.nickname });
  },
  'report-room': () => openReport('room', undefined, currentRoom?.report),
  'report-list-room': target => confirmAge(() => openReport('room-list', undefined, { nickname: '房间玩家', watchKey: target.dataset.target })),
  'report-result': () => openReport('result', undefined, currentRoom?.report),
  'report-recent': () => openReport('result', undefined, recentReport),
  'bind-friends': bindFriends,
  'retry-room': () => pollRoom(true),
  'refresh-rooms': refreshActiveRooms,
  'refresh-social': () => refreshLobby(true),
  'reset-online-filters': () => {
    for (const id of Object.keys(onlineFilterOptions)) $(`#${id}`).value = 'all';
    $('#online-compatible').checked = false;
    renderSocial();
    $('#online-gender').focus();
  },
  'clear-queue': async () => {
    await call('clear-queue');
    queueConflict = false;
    renderSocial();
    return refreshLobby(true);
  },
  'close-social': closeSocial,
  'edit-replies': editReplies,
  'edit-custom-hints': editCustomHints,
  'control-layout': target => {
    preferences.controlLayout = target.dataset.layout;
    savePreferences();
    render();
    roomElement.querySelector(`[data-layout="${preferences.controlLayout}"]`)?.focus({ preventScroll: true });
  },
  'reset-replies': () => {
    for (const box of dialog.querySelectorAll('#reply-settings input[name="reply"]')) box.checked = defaultReplies.includes(box.value);
    dialog.querySelector('.form-error').hidden = true;
  },
  'edit-voice-sample': () => confirmAge(() => {
    popup('我的语音试听', voiceSampleEditor);
    voiceSample = new VoiceSampleEditor(dialog.querySelector('.voice-sample'), async () => {
      await identityReady;
      return guestKey;
    }, () => refreshLobby(true));
  }),
  'play-voice-sample': target => {
    const account = target.dataset.target;
    if (!/^[a-f0-9]{64}$/.test(account)) return;
    popup('语音试听', `<section class="voice-sample"><audio controls preload="metadata" src="/api/voice-sample/${account}" aria-label="玩家录音"></audio>
      <p role="status" hidden>这段试听已下架或暂时无法播放。</p></section>`);
    const audio = dialog.querySelector('.voice-sample audio');
    const notice = dialog.querySelector('.voice-sample [role="status"]');
    audio.addEventListener('error', () => { notice.hidden = false; });
    audio.play().catch(() => {});
  },
  'invite-player': target => call('invite', { ...lobbyValues(), target: target.dataset.target }),
  'accept-invite': target => call('invite-response', { ...lobbyValues(), invite: target.dataset.target, response: 'accept' }),
  'decline-invite': target => call('invite-response', { ...lobbyValues(), invite: target.dataset.target, response: 'decline' }),
  'add-friend': () => addFriend(),
  'add-previous-friend': () => addFriend(currentRoom.previousRound),
  'standby-join': async target => {
    try {
      await joinWithRetry('standby-join', { ...lobbyValues(), target: target.dataset.target }, () => mode === 'lobby',
        () => showToast('正在重新确认候补位置…'));
    } catch (error) {
      showToast(['TimeoutError', 'AbortError', 'TypeError'].includes(error.name) ? '暂时无法确认候补位置，请重试。' : error.message);
    }
  },
  'standby-open': () => call('standby-open', { open: !currentRoom.standby.open }),
  'watch-open': () => call('watch-open', { open: !currentRoom.audience.preferOpen, shareDetails: true }),
  'watch-audio-allow': () => call('watch-audio-open', { open: true }),
  'watch-audio-block': () => call('watch-audio-open', { open: false }),
  'watch-join': target => {
    const key = target.dataset.target;
    return confirmAge(async () => {
      if (pendingWatchJoin) return;
      pendingWatchJoin = true;
      watchKey = key;
      try {
        const data = await joinWithRetry('watch-join', { ...lobbyValues(), key }, () => mode === 'lobby',
          () => showToast('连接暂时中断，正在重新进入观战…'));
        if (data?.state === 'watching') $('#toast').classList.remove('show');
      } catch (error) {
        showToast(error.message);
        refreshActiveRooms();
      } finally {
        pendingWatchJoin = false;
      }
    });
  },
  'accept-friend': target => respondFriend(target.dataset.target, 'accept'),
  'decline-friend': target => respondFriend(target.dataset.target, 'decline'),
  'remove-friend': target => respondFriend(target.dataset.target, 'remove'),
  'create-friend': createFriend,
  match: () => confirmAge(matchPreferences),
  solo: () => confirmAge(practice),
  'confirm-age': () => {
    preferences.adult = true;
    savePreferences();
    dialog.close();
    ageNext?.();
    ageNext = undefined;
    refreshFriendPresence();
  },
  ready: () => call('ready', { ready: !currentRoom.players[currentRoom.me].ready, watchOpen: $('#round-watch-open')?.checked, shareDetails: true,
    durationRevision: currentRoom.durationRevision, partnerRevision: currentRoom.standby?.revision }),
  duration: changeDuration,
  cue: target => call('cue', { cue: target.dataset.cue, round: currentRoom.game.id }),
  'round-input': target => sendRoundInput(target.dataset.kind, target.dataset.value),
  'room-panel': target => {
    const panel = target.dataset.panel;
    if (roomElement.dataset.roomPanel === panel) {
      delete roomElement.dataset.roomPanel;
    } else {
      roomElement.dataset.roomPanel = panel;
      const content = document.getElementById(target.getAttribute('aria-controls'));
      if (panel === 'more') content.querySelector('details').open = true;
      content.focus({ preventScroll: true });
    }
    render();
  },
  'close-room-panel': () => {
    const previous = roomElement.dataset.roomPanel;
    delete roomElement.dataset.roomPanel;
    if (previous) roomElement.querySelector(`[data-panel="${previous}"]`)?.focus();
    render();
  },
  'finish-round': () => sendRoundInput('finish'),
  'sound-toggle': async target => {
    preferences.sound = target.getAttribute('aria-pressed') !== 'true';
    savePreferences();
    if (preferences.sound) {
      await activateSound();
      if (!beat(900)) showToast('节拍声尚未启用，请再点一次开启。');
    }
    render();
  },
  pause: togglePause,
  mark: markStop,
  copy: copyInvite,
  replay: () => startSolo(solo.seconds, solo.difficulty),
  listen: () => voice?.listen(),
  'retry-voice': () => voice?.retry(currentRoom),
  'voice-fallback': () => voice?.useFallback(),
  'voice-request': () => call('voice-request'),
  'voice-accept': () => call('voice-response', { voiceId: currentRoom.voice.id, response: 'accept' }),
  'voice-decline': () => call('voice-response', { voiceId: currentRoom.voice.id, response: 'decline' }),
  'voice-close': () => {
    const voiceId = currentRoom.voice.id;
    silencedVoice = voiceId;
    voice?.destroy();
    voice = undefined;
    busyMic = false;
    render();
    return call('voice-close', { voiceId });
  },
  mic: async () => {
    if (!voice || busyMic) return;
    const instance = voice;
    busyMic = true;
    instance.micStatus = undefined;
    render();
    try {
      await instance.microphone();
    } catch (error) {
      if (voice === instance) instance.micStatus = voiceError(error);
    } finally {
      if (voice === instance) {
        busyMic = false;
        render();
      }
    }
  }
};

document.addEventListener('click', event => {
  const preset = event.target.closest('[data-duration]');
  if (preset) {
    const field = preset.closest('.duration-field');
    const input = field.querySelector('input[name="minutes"]');
    input.value = preset.dataset.duration;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  event.preventDefault();
  activateSound();
  Promise.resolve(actions[target.dataset.action]?.(target)).catch(error => showToast(error.message || '操作失败，请重试。'));
});

dialog.addEventListener('close', () => {
  if (!dialog.open) {
    dialog.querySelector('.voice-sample audio')?.pause();
    voiceSample?.destroy();
    voiceSample = undefined;
  }
  if (!friendChat || dialog.open) return;
  friendChat.closed = true;
  friendChat = undefined;
  refreshLobby();
});
setInterval(() => { if (dialog.open) friendChat?.refresh(); }, 5000);

document.addEventListener('input', event => {
  const input = event.target;
  if (input.matches('[data-control-range]')) {
    input.closest('label').querySelector('output').textContent = input.dataset.roundKind === 'tempo'
      ? tempoBands[Number(input.value)] + ' BPM' : input.value + ' / ' + input.max + ' 档';
    return;
  }
  if (input.name !== 'minutes') return;
  for (const preset of input.closest('.duration-field').querySelectorAll('[data-duration]')) {
    preset.setAttribute('aria-pressed', String(Number(preset.dataset.duration) === Number(input.value)));
  }
});

document.addEventListener('change', event => {
  if (event.target.closest('#online-filters')) renderSocial();
  if (event.target.id === 'show-online' || event.target.id === 'online-role') {
    preferences.visible = $('#show-online').checked;
    preferences.profile = normalizeProfile({ ...preferences.profile, role: $('#online-role').value });
    savePreferences();
    refreshLobby(true);
    return;
  }
  const field = event.target.closest('[data-round-kind]');
  if (!field) return;
  activateSound();
  const value = field.hasAttribute('data-control-range') && field.dataset.roundKind === 'tempo'
    ? tempoBands[Number(field.value)] : field.value;
  sendRoundInput(field.dataset.roundKind, value)?.catch(error => {
    controlKey = '';
    render();
    showToast(error.message);
  });
});

document.addEventListener('submit', event => {
  const form = event.target;
  const data = new FormData(form);
  event.preventDefault();
  if (form.id === 'custom-hint-settings') {
    const texts = [...new Set(String(data.get('hints')).split('\n').map(cleanCustomHint).filter(Boolean))];
    const feedback = form.querySelector('.form-error');
    if (texts.length > customHintCount || texts.some(text => text.length > customHintLimit)) {
      feedback.hidden = false;
      feedback.textContent = `请填写最多 ${customHintCount} 句，每句最多 ${customHintLimit} 字。`;
      return;
    }
    try {
      localStorage.setItem('jianke-custom-hints', JSON.stringify(texts));
      dialog.close();
      controlKey = '';
      render();
    } catch {
      feedback.hidden = false;
      feedback.textContent = '浏览器未能保存设置。';
    }
    return;
  }
  if (form.id === 'reply-settings') {
    const chosen = data.getAll('reply');
    const feedback = form.querySelector('.form-error');
    if (chosen.length > 5) {
      feedback.hidden = false;
      feedback.textContent = '最多选择 5 条常用回馈。';
      return;
    }
    try {
      localStorage.setItem('jianke-favorite-replies', JSON.stringify(chosen));
      dialog.close();
      controlKey = '';
      render();
    } catch {
      feedback.hidden = false;
      feedback.textContent = '浏览器未能保存设置。';
    }
    return;
  }
  if (form.id === 'report-form') {
    sendReport(form, data);
    return;
  }
  const seconds = Number(data.get('minutes')) * 60;
  if (data.has('minutes') && !validRoundSeconds(seconds)) return;
  if (data.has('minMinutes')) {
    const limits = { minMinutes: Number(data.get('minMinutes')), maxMinutes: Number(data.get('maxMinutes')), maxIntensity: Number(data.get('maxIntensity')) };
    const error = form.querySelector('.form-error');
    if (!validRoundLimits(limits)) {
      error.hidden = false;
      error.textContent = '最短时长须小于或等于最长时长，范围为 1–120 分钟。';
      return;
    }
    error.hidden = true;
    preferences.limits = limits;
    savePreferences();
  }
  if (form.id === 'settings-form') {
    preferences.nickname = String(data.get('nickname')).trim().slice(0, 16);
    preferences.sound = data.has('sound');
    preferences.speech = data.has('speech');
    savePreferences();
    if (!preferences.speech) window.speechSynthesis?.cancel();
    dialog.close();
    activateSound();
    const hasChinese = window.speechSynthesis?.getVoices().some(item => /^zh([-_]|$)/i.test(item.lang));
    showToast(preferences.speech && !hasChinese ? '设置已保存。此浏览器暂未提供中文语音。' : '设置已保存');
  } else if (form.id === 'practice-form') {
    startSolo(seconds, data.get('difficulty'));
  } else if (form.id === 'match-form') {
    preferences.profile = profileFrom(data);
    savePreferences();
    enter('match', {}, form);
  } else if (form.id === 'online-limits-form') {
    const gender = data.get('publicGender');
    preferences.publicGender = Object.hasOwn(genders, gender) ? gender : 'unspecified';
    preferences.profile = profileFrom(data);
    savePreferences();
    call('lobby', lobbyValues()).then(() => showToast('对局偏好已保存')).catch(error => showToast(error.message));
  } else if (form.id === 'create-form') {
    enter('create', { profile: profileFrom(data), seconds, difficulty: data.get('difficulty') }, form);
  } else if (form.id === 'duration-form') {
    submitRoomAction('duration', { seconds }, form);
  } else if (form.id === 'friend-form') {
    const code = String(data.get('roomCode')).trim().toUpperCase();
    if (/^[A-HJ-NP-Z2-9]{6}$/.test(code)) enter('join', { code, profile: profileFrom(data) }, form);
    else {
      const error = form.querySelector('.form-error');
      error.hidden = false;
      error.textContent = '请输入好友提供的 6 位房间码。';
    }
  }
});

document.addEventListener('keydown', event => {
  if ($('#pause-notice')?.open) return;
  if (event.key === 'Escape' && !dialog.open && window.matchMedia('(max-width: 600px)').matches &&
      roomElement.classList.contains('compact-round') && roomElement.dataset.roomPanel) {
    actions['close-room-panel']();
    return;
  }
  if (event.code !== 'Space' || event.repeat || dialog.open || event.target.closest('button, input, a, select, textarea')) return;
  const control = roomElement.querySelector('[data-action="mark"]:enabled');
  if (control) {
    event.preventDefault();
    control.click();
  }
});

friendPresenceToggle.checked = shareFriendPresence;
friendPresenceToggle.addEventListener('change', () => {
  const shared = friendPresenceToggle.checked;
  try { localStorage.setItem(friendPresenceKey, shared ? 'on' : 'off'); } catch {}
  setFriendPresence(shared);
});
window.addEventListener('storage', event => {
  if (event.key === friendPresenceKey) setFriendPresence(event.newValue === 'on');
});

window.addEventListener('pagehide', event => {
  if (friendPresenceShared) {
    navigator.sendBeacon?.('/api/room', JSON.stringify({ id: friendPresenceTab, guestKey, adult: preferences.adult,
      action: 'friend-presence', sharing: 'hide' }));
  }
  dialog.querySelector('.voice-sample audio')?.pause();
  voiceSample?.destroy();
  voiceSample = undefined;
  if (event.persisted && ['online', 'queue', 'watch'].includes(mode)) return;
  if (matchIntent) return;
  if (!event.persisted && mode === 'solo' && solo) recordPractice(solo, getProgress(solo, Date.now()), Date.now());
  const inRoom = mode === 'online' || mode === 'queue';
  voice?.destroy();
  audienceVoice?.destroy();
  const watching = mode === 'watch';
  if (watching) spectator?.destroy();
  if (inRoom || preferences.adult) navigator.sendBeacon?.('/api/room', JSON.stringify({ id: playerId, guestKey, key: watchKey, adult: preferences.adult,
    action: watching ? 'watch-leave' : inRoom ? 'leave' : 'lobby-away' }));
  if ((inRoom || watching) && event.persisted) resetLobby();
});

window.addEventListener('focus', () => { mutedUntil = Date.now() + 120; });
setInterval(render, 85);
async function pollRoom(urgent = false) {
  if (pendingPoll || !['online', 'queue', 'watch'].includes(mode) || (!urgent && Date.now() < pollRetryAt)) return;
  if (mode === 'queue') {
    if (!urgent && Date.now() - lastQueuePoll < 4000) return;
    lastQueuePoll = Date.now();
  }
  pendingPoll = true;
  const session = roomVersion;
  try {
    if (navigator.onLine === false) throw new Error('当前没有网络连接。');
    const action = mode === 'watch' ? 'watch-sync' : mode === 'queue' && matchIntent ? 'match' : 'sync';
    const matchId = matchIntent?.matchId;
    const response = await call(action, action === 'match'
      ? { ...matchIntent, queueHeartbeat: matchId === confirmedMatchId }
      : { standbyCode: standbyStatus?.code }, session);
    if (action === 'match' && response?.state === 'queued' && matchIntent?.matchId === matchId) confirmedMatchId = matchId;
    if (session !== roomVersion) return;
    pollFailures = 0;
    pollRetryAt = 0;
  } catch (error) {
    if (session !== roomVersion) return;
    if (mode === 'queue' && matchIntent && [400, 403, 409].includes(error.status)) {
      resetLobby();
      showToast(error.message);
      return;
    }
    lostSince ||= Date.now();
    pollError = error.code === 'queue-full' ? 'queue-full' : error.status === 429 || error.status >= 500 ? 'busy' : 'network';
    pollFailures = Math.min(pollFailures + 1, 4);
    pollRetryAt = Date.now() + 400 * 2 ** pollFailures + Math.random() * 350;
  } finally {
    pendingPoll = false;
  }
}
setInterval(pollRoom, 1250);
function reconnectVisiblePage() {
  if (document.hidden) return;
  if (mode === 'queue' || pendingRoomChime) activateSound();
  refreshFriendPresence();
  if (mode === 'lobby') {
    refreshLobby();
    refreshActiveRooms();
  } else pollRoom(true);
}
window.addEventListener('online', reconnectVisiblePage);
window.addEventListener('online', () => voice?.resumeNetwork());
window.addEventListener('pageshow', reconnectVisiblePage);
document.addEventListener('visibilitychange', reconnectVisiblePage);
setInterval(refreshFriendPresence, 15_000);
setInterval(() => {
  if (lastRound || recentReport) renderSocial();
  refreshLobby();
  refreshActiveRooms();
}, 8000);

const historyView = new HistoryView($('#round-history'), values => call('history', values), seq => call('history-friend-add', { seq }));
icons(document);
for (const [id, options] of Object.entries(onlineFilterOptions)) {
  for (const [value, label] of Object.entries(options)) $(`#${id}`).add(new Option(label, value));
}
savePreferences();
window.speechSynthesis?.getVoices?.();
const params = new URLSearchParams(location.search);
const invite = params.get('room')?.toUpperCase();
if (archiveMode) {
  rememberDeparture(false);
  saveMatchIntent(undefined);
}
const pageRemaining = document.body.dataset.archiveMs ?? document.body.dataset.encoreMs;
if (pageRemaining !== undefined) setTimeout(() => location.replace('/'), Number(pageRemaining));
if (!archiveMode && invite && /^[A-HJ-NP-Z2-9]{6}$/.test(invite)) confirmAge(() => friend(invite));
else if (params.has('friends')) {
  const url = new URL(location.href);
  url.searchParams.delete('friends');
  history.replaceState(null, '', url);
  confirmAge(() => openSocial('friends'));
}
else if (!archiveMode && preferences.adult) {
  let savedMatch;
  try { savedMatch = JSON.parse(sessionStorage.getItem('jianke-match')); } catch {}
  if (savedMatch) {
    saveMatchIntent({ ...lobbyValues(), profile: normalizeProfile(savedMatch.profile), limits: normalizeRoundLimits(savedMatch.limits),
      matchId: savedMatch.matchId ?? randomClientId() });
    openScreen('queue');
    pollRoom(true);
  }
}
window.dispatchEvent(new Event('jianke-ready'));
renderSocial();
refreshLobby();
refreshFriendPresence();
refreshActiveRooms();
