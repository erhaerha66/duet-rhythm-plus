import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { json } from './game.mjs';

const cookieName = 'duet_admin';
const sessionSeconds = 8 * 3600;
const attemptWindow = 15 * 60_000;
const digest = value => createHash('sha256').update(value).digest();

function matches(value, expected) {
  return typeof value === 'string' && value.length <= 256 && expected &&
    timingSafeEqual(digest(value), expected);
}

export function createAdminAuth(settings) {
  const password = settings.ADMIN_PASSWORD ? digest(settings.ADMIN_PASSWORD) : undefined;
  const proxyKey = settings.IDENTITY_PROXY_KEY ? digest(settings.IDENTITY_PROXY_KEY) : undefined;
  const sessions = new Map();
  const attempts = new Map();
  let attemptsUntil = 0;
  const adminEmail = 'local-admin@example.invalid';
  const idHeader = 'oai-authenticated-user-id';
  const emailHeader = 'oai-authenticated-user-email';
  const proxyHeader = 'x-duet-identity-key';
  const session = request => new RegExp(`(?:^|; *)${cookieName}=([0-9a-f]{64})(?:;|$)`).exec(request.headers.get('cookie') ?? '')?.[1];
  const cookie = (value, age, url) => `${cookieName}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${age}${url.protocol === 'https:' ? '; Secure' : ''}`;

  return {
    adminEmail,
    identityHeaders(request) {
      const headers = new Headers(request.headers);
      const upstreamUser = headers.get(idHeader);
      const trusted = matches(headers.get(proxyHeader), proxyKey);
      headers.delete(idHeader);
      headers.delete(emailHeader);
      headers.delete(proxyHeader);
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/admin') && sessions.get(session(request)) > Date.now()) {
        headers.set(idHeader, 'local-admin');
        headers.set(emailHeader, adminEmail);
      } else if (url.pathname === '/api/friend-identity' && trusted && upstreamUser && upstreamUser.length <= 256) {
        headers.set(idHeader, upstreamUser);
      }
      return headers;
    },
    async handle(request, source) {
      const url = new URL(request.url);
      if (request.method !== 'POST' || request.headers.get('Origin') !== url.origin) {
        return json({ error: '请从同源的管理页面发起请求。' }, 403);
      }
      if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
        return json({ error: '管理员登录需要 HTTPS。' }, 403);
      }
      const now = Date.now();
      if (url.pathname === '/api/admin/logout') {
        sessions.delete(session(request));
        const response = json({ signedIn: false });
        response.headers.set('Set-Cookie', cookie('', 0, url));
        return response;
      }
      if (!password) return json({ error: '请先在服务器设置 ADMIN_PASSWORD。' }, 503);
      if (now >= attemptsUntil) {
        attempts.clear();
        attemptsUntil = now + attemptWindow;
      }
      const count = attempts.get(source) ?? 0;
      if (count >= 8 || (!attempts.has(source) && attempts.size >= 1024)) {
        return json({ error: '登录尝试过多，请稍后再试。' }, 429);
      }
      let input;
      try { input = await request.json(); } catch {}
      if (!matches(input?.password, password)) {
        attempts.set(source, count + 1);
        return json({ error: '管理密码不正确。' }, 401);
      }
      attempts.delete(source);
      for (const [token, expiry] of sessions) if (expiry <= now) sessions.delete(token);
      sessions.delete(session(request));
      if (sessions.size >= 128) sessions.delete(sessions.keys().next().value);
      const token = randomBytes(32).toString('hex');
      sessions.set(token, now + sessionSeconds * 1000);
      const response = json({ signedIn: true });
      response.headers.set('Set-Cookie', cookie(token, sessionSeconds, url));
      return response;
    }
  };
}
