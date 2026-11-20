export const paces = {
  easy: { label: '轻松', range: [10, 15], pause: [6, 9] },
  normal: { label: '标准', range: [7, 12], pause: [5, 8] },
  hard: { label: '进阶', range: [4, 8], pause: [4, 7] }
};

export const cues = {
  fast: { title: '加快', detail: '跟上明快的节拍。', icon: 'zap', bpm: 100 },
  slow: { title: '放慢', detail: '把动作放慢，跟随节拍。', icon: 'wave', bpm: 55 },
  stop: { title: '停拍', detail: '停下动作。准备好后，记录这次停拍。', icon: 'hand', bpm: 0 }
};

export const tempos = { 40: '很慢', 55: '慢速', 75: '均速', 100: '快速', 130: '很快', 150: '高速', 170: '更快', 190: '极速', 210: '最高速' };
export const shortStops = [10, 20, 30];
export const extensions = [30, 60];
export const focusOptions = { free: '自选', breath: '呼吸', hands: '手部', shoulders: '肩颈', chest: '胸前', waist: '腰腹', legs: '腿部' };
export const coachHints = {
  step: '跟一拍做一步', breathe: '把呼吸放稳', steady: '保持这个节奏', prepare: '准备停下', praise: '刚才做得很稳',
  check: '这个节奏舒服吗？', ready: '准备好了就告诉我', relax: '先放松肩膀', 'own-pace': '按你舒服的速度来',
  'steady-hands': '动作放轻，慢慢跟拍', 'shorter-move': '把动作幅度收小一点', 'change-step': '下一拍换个节奏',
  'wait-cue': '留一点悬念，等我给下一拍', 'not-yet': '这轮先停在这儿', 'surprise': '猜猜下一拍是快还是慢',
  'changed-mind': '等一下，我想换种节奏', 'stretch-wait': '这次等待稍微久一点',
  'nicely-paced': '刚才那个节奏很稳', 'good-stop': '这次收得很利落', 'well-heard': '你的回馈很清楚',
  'well-timed': '这一下时机刚刚好', 'good-round': '刚才那一轮配合得很好',
  'final-beats': '最后几拍，按自己的速度来', 'three-beats': '再跟三拍就休息', 'count-down': '三、二、一，收拍',
  'halfway': '已经过半了，感受一下现在的节奏', 'one-more': '如果舒服，就再试一轮',
  'take-breath': '给自己一点时间，先呼吸', 'ease-off': '觉得紧张就把动作放轻', 'go-easy': '不用赶，舒服最重要',
  'in-control': '需要调整就告诉我', 'thank-you': '谢谢你告诉我感受', 'wrap-up': '这轮到这里，慢慢放松',
  'say-pace': '告诉我你想要什么速度', 'say-rest': '想休息的话直接告诉我', 'say-ready': '用你方便的方式告诉我准备好了',
  'say-boundary': '有没有想跳过的动作？', 'say-change': '想换动作还是先休息？'

};
export const coachHintGroups = [
  ['节奏', ['step', 'steady', 'prepare', 'steady-hands', 'shorter-move', 'change-step']],
  ['留点悬念', ['wait-cue', 'not-yet', 'surprise', 'changed-mind', 'stretch-wait']],
  ['肯定与鼓励', ['praise', 'nicely-paced', 'good-stop', 'well-heard', 'well-timed', 'good-round']],
  ['倒数与挑战', ['final-beats', 'three-beats', 'count-down', 'halfway', 'one-more']],
  ['放松与安抚', ['breathe', 'relax', 'own-pace', 'take-breath', 'ease-off', 'go-easy', 'wrap-up']],
  ['确认与表达', ['check', 'ready', 'in-control', 'thank-you', 'say-pace', 'say-rest', 'say-ready', 'say-boundary', 'say-change']]
];
export const customHintLimit = 48;
export const customHintCount = 12;
export function cleanCustomHint(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, '').trim() : '';
}
export const receiverReplies = {
  slower: '想慢一点', faster: '可以再快一些', same: '这个节奏合适', rhythm: '想换个节奏', hold: '想多停一会儿',
  gentler: '想轻一点', stronger: '可以稍微加一点强度', change: '想换个动作', 'keep-action': '想保持这个动作',
  comfortable: '现在感觉舒服', ready: '我准备好了', limit: '快到极限了', 'check-in': '想先确认一下', rest: '需要休息',
  uncomfortable: '不舒服，先暂停', boundary: '这个动作我不想继续', 'more-time': '想再休息一会儿', recovered: '我缓过来了',
  'need-time': '给我一点时间', 'repeat-pace': '想再试一次刚才的节奏', 'ask-first': '变换前请先问我',
  'feeling-better': '比刚才好一些', 'feel-unsure': '我还没确定', 'appreciate-check': '谢谢你先问我',
  'keep-communicating': '希望你多问问我的感受'
};

export const durationPresets = [1, 3, 5, 10, 15, 20, 30, 45, 60];
export const defaultRoundSeconds = 10 * 60;
export const maxRoundMinutes = 120;
export const maxIntensity = 5;
export const defaultRoundLimits = { minMinutes: 1, maxMinutes: maxRoundMinutes, maxIntensity };

export function validRoundSeconds(seconds) {
  return Number.isInteger(seconds) && seconds >= 60 && seconds <= maxRoundMinutes * 60 && seconds % 60 === 0;
}

export function validRoundLimits(limits) {
  return limits && Number.isInteger(limits.minMinutes) && Number.isInteger(limits.maxMinutes) &&
    limits.minMinutes >= 1 && limits.minMinutes <= limits.maxMinutes && limits.maxMinutes <= maxRoundMinutes &&
    Number.isInteger(limits.maxIntensity) && limits.maxIntensity >= 0 && limits.maxIntensity <= maxIntensity;
}

export function normalizeRoundLimits(limits) {
  const { minMinutes, maxMinutes, maxIntensity } = validRoundLimits(limits) ? limits : defaultRoundLimits;
  return { minMinutes, maxMinutes, maxIntensity };
}

export function sharedRoundLimits(first, second) {
  const a = normalizeRoundLimits(first);
  const b = normalizeRoundLimits(second);
  const minMinutes = Math.max(a.minMinutes, b.minMinutes);
  const maxMinutes = Math.min(a.maxMinutes, b.maxMinutes);
  return minMinutes <= maxMinutes ? { minMinutes, maxMinutes, maxIntensity: Math.min(a.maxIntensity, b.maxIntensity) } : null;
}

export function withinRoundLimits(seconds, limits) {
  return seconds >= limits.minMinutes * 60 && seconds <= limits.maxMinutes * 60;
}

export function fitRoundSeconds(seconds, limits) {
  return Math.min(limits.maxMinutes * 60, Math.max(limits.minMinutes * 60, seconds));
}

export function plan(seconds, difficulty, seed = Math.floor(Math.random() * 0x100000000)) {
  const pace = paces[difficulty] ?? paces.normal;
  const kinds = ['fast', 'slow', 'fast', 'stop', 'slow', 'stop', 'fast', 'stop'];
  const phases = [];
  let state = seed;
  let end = 0;
  while (end < seconds * 1000) {
    const kind = kinds[phases.length % kinds.length];
    const [min, max] = kind === 'stop' ? pace.pause : pace.range;
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const duration = min + Math.floor(state / 0x100000000 * (max - min + 1));
    end = Math.min(seconds * 1000, end + duration * 1000);
    phases.push({ kind, end });
  }
  return phases;
}

export function roundPhases(game) {
  return game.phases ?? plan(game.seconds, game.difficulty, game.seed);
}

export function getProgress(game, now, phases = game && roundPhases(game)) {
  if (!game) return null;
  const roomTime = game.finishedAt ?? game.pausedAt ?? Math.max(now, game.resumeAt ?? 0);
  const elapsed = Math.min(game.seconds * 1000, roomTime - game.startAt);
  const automaticIndex = game.finishedAt == null ? phases.findIndex(phase => elapsed < phase.end) : -1;
  const saved = automaticIndex >= 0 ? game.liveCue : null;
  const live = saved?.until != null && elapsed >= saved.until ? saved.resume : saved;
  return {
    elapsed,
    index: live?.id ?? automaticIndex,
    phase: live ?? phases[automaticIndex],
    phaseStart: live?.since ?? (phases[automaticIndex - 1]?.end ?? 0),
    live,
    done: automaticIndex < 0,
    remaining: automaticIndex < 0 ? 0 : Math.max(0, game.seconds * 1000 - elapsed)
  };
}
