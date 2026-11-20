import { guestAccount, json, securityHeaders } from './game.mjs';
import { moderationNetwork } from './moderation.mjs';
import { parseByteRange } from './report-files.mjs';

const voiceSampleRate = 16_000;
const voiceSampleLimit = 44 + voiceSampleRate * 2 * 5;

export function databaseVoiceSamples(db) {
  return {
    async get(account) {
      const row = await db.prepare('SELECT audio FROM voice_samples WHERE account = ?').bind(account).first();
      return row && new Uint8Array(row.audio);
    },
    async save(account, audio) {
      await db.prepare('INSERT INTO voice_samples (account, audio) VALUES (?, ?) ON CONFLICT(account) DO UPDATE SET audio = excluded.audio')
        .bind(account, audio).run();
    },
    async remove(account) {
      await db.prepare('DELETE FROM voice_samples WHERE account = ?').bind(account).run();
    },
    async available(accounts) {
      if (!accounts.length) return new Set();
      const { results } = await db.prepare('SELECT account FROM voice_samples WHERE account IN (SELECT value FROM json_each(?))')
        .bind(JSON.stringify(accounts)).all();
      return new Set(results.map(row => row.account));
    }
  };
}

export function memoryVoiceSamples() {
  const clips = new Map();
  return {
    get: account => clips.get(account),
    save: (account, audio) => clips.set(account, audio),
    remove: account => clips.delete(account),
    available: accounts => new Set(accounts.filter(account => clips.has(account)))
  };
}

function validVoiceSample(bytes) {
  if (bytes.byteLength <= 44 || bytes.byteLength > voiceSampleLimit || bytes.byteLength % 2) return false;
  const wav = new DataView(bytes);
  return wav.getUint32(0) === 0x52494646 && wav.getUint32(4, true) === bytes.byteLength - 8 &&
    wav.getUint32(8) === 0x57415645 && wav.getUint32(12) === 0x666d7420 && wav.getUint32(16, true) === 16 &&
    wav.getUint16(20, true) === 1 && wav.getUint16(22, true) === 1 && wav.getUint32(24, true) === voiceSampleRate &&
    wav.getUint32(28, true) === voiceSampleRate * 2 && wav.getUint16(32, true) === 2 &&
    wav.getUint16(34, true) === 16 && wav.getUint32(36) === 0x64617461 && wav.getUint32(40, true) === bytes.byteLength - 44;
}

export async function voiceSampleApi(request, store, settings, moderation, sourceIp) {
  if (!store) return json({ error: '试听服务暂时不可用。' }, 503);
  const url = new URL(request.url);
  const publicAccount = /^\/api\/voice-sample\/([a-f0-9]{64})$/.exec(url.pathname)?.[1];
  if (publicAccount && !['GET', 'HEAD'].includes(request.method)) return json({ error: '请求无效。' }, 405);
  if (!publicAccount && (url.pathname !== '/api/voice-sample' || !['POST', 'DELETE'].includes(request.method))) {
    return json({ error: '找不到语音试听。' }, 404);
  }
  if (!publicAccount && request.headers.get('Origin') !== url.origin) return json({ error: '请从游戏页面发起请求。' }, 403);
  const account = publicAccount ?? await guestAccount(request.headers.get('X-Jianke-Guest-Key'));
  if (!account) return json({ error: '请刷新页面后再试。' }, 403);
  if (request.method === 'DELETE') {
    await store.remove(account);
    return json({ removed: true });
  }
  if (moderation && settings.MODERATION_KEY) {
    const now = Date.now();
    const network = await moderationNetwork(sourceIp, settings.MODERATION_KEY);
    const banned = (await moderation.active(now)).some(ban => ban.until > now && (ban.target === account || (network && ban.network === network)));
    if (banned) return json({ error: '语音试听暂不可用。' }, 403);
  }
  if (publicAccount) {
    const audio = await store.get(account);
    if (!audio) return json({ error: '这段试听已下架或尚未发布。' }, 404);
    const headers = new Headers({ ...securityHeaders, 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' });
    const requested = request.headers.get('Range');
    const range = requested && parseByteRange(requested, audio.byteLength);
    if (requested && !range) {
      headers.set('Content-Range', `bytes */${audio.byteLength}`);
      return new Response(null, { status: 416, headers });
    }
    if (range) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${audio.byteLength}`);
    const body = range ? audio.subarray(range.start, range.end + 1) : audio;
    headers.set('Content-Length', String(body.byteLength));
    return new Response(request.method === 'HEAD' ? null : body, { status: range ? 206 : 200, headers });
  }
  if (request.headers.get('Content-Type') !== 'audio/wav') return json({ error: '请使用站内录音。' }, 415);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: '请先录制试听。' }, 400);
  const buffer = new Uint8Array(voiceSampleLimit);
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (size + value.byteLength > buffer.byteLength) {
      await reader.cancel();
      return json({ error: '试听最多 5 秒。' }, 413);
    }
    buffer.set(value, size);
    size += value.byteLength;
  }
  const audio = buffer.buffer.slice(0, size);
  if (!validVoiceSample(audio)) return json({ error: '录音无效，请重新录制。' }, 400);
  await store.save(account, audio);
  return json({ published: true });
}
