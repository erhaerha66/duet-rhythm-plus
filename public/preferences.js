export const genders = {
  unspecified: '不透露', woman: '女性', man: '男性', nonbinary: '非二元', other: '其他'
};
export const orientations = {
  unspecified: '不透露', straight: '异性恋', gay: '同性恋', bi: '双性恋',
  pan: '泛性恋', ace: '无性恋', queer: '酷儿', other: '其他'
};
export const roles = { either: '都可以', controller: '领拍者', receiver: '跟拍者' };
export const targets = { auto: '根据性取向推荐', any: '不限性别', woman: '女性', man: '男性', nonbinary: '非二元', other: '其他' };
export const voicePreferences = { any: '不限', off: '双方都不开麦', both: '双方都开麦', self: '我开麦，对方不开', peer: '对方开麦，我不开' };

export function normalizeProfile(profile) {
  return {
    gender: Object.hasOwn(genders, profile?.gender) ? profile.gender : 'unspecified',
    orientation: Object.hasOwn(orientations, profile?.orientation) ? profile.orientation : 'unspecified',
    role: Object.hasOwn(roles, profile?.role) ? profile.role : 'either',
    target: Object.hasOwn(targets, profile?.target) ? profile.target : 'auto',
    voice: Object.hasOwn(voicePreferences, profile?.voice) ? profile.voice : 'any',
    address: typeof profile?.address === 'string' ? Array.from(profile.address.replace(/\p{C}/gu, '').trim()).slice(0, 16).join('') : '',
    shareAddress: profile?.shareAddress === true || profile?.shareAddress === '1'
  };
}

export function desiredGender(profile) {
  if (profile.target !== 'auto') return profile.target;
  if (profile.orientation === 'straight') {
    if (profile.gender === 'woman') return 'man';
    if (profile.gender === 'man') return 'woman';
  }
  if (profile.orientation === 'gay' && profile.gender !== 'unspecified' && profile.gender !== 'other') {
    return profile.gender;
  }
  return 'any';
}

export function voiceAgreement(first, second) {
  const own = normalizeProfile(first).voice;
  const other = normalizeProfile(second).voice;
  const fromOwnSide = other === 'self' ? 'peer' : other === 'peer' ? 'self' : other;
  if (own === 'any') return fromOwnSide;
  return other === 'any' || own === fromOwnSide ? own : null;
}

export function roomController(first, second) {
  const a = normalizeProfile(first).role;
  const b = normalizeProfile(second).role;
  if (a === b && a !== 'either') return null;
  return a === 'receiver' || b === 'controller' ? 1 : 0;
}
