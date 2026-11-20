import { adminUsersApi } from './admin-users.mjs';
import { databaseFriends } from './friends.mjs';
import { api, databaseStore, json, securityHeaders } from './game.mjs';
import { databaseHistory } from './history.mjs';
import { databaseModeration } from './moderation.mjs';
import { databaseTraffic, trafficApi } from './traffic.mjs';
import { databaseVoiceSamples } from './voice-samples.mjs';
import { maxReportRequestBytes } from '../public/report-files.js';

export function createSitesWorker(assets) {
  return {
    async fetch(request, env) {
      const { pathname } = new URL(request.url);
      if (!pathname.startsWith('/api/')) {
        const path = pathname === '/' ? '/index.html' : ['/admin', '/admin/'].includes(pathname) ? '/admin.html' : pathname;
        const asset = Object.hasOwn(assets, path) && assets[path];
        if (!asset || !['GET', 'HEAD'].includes(request.method)) return new Response('找不到页面', { status: 404 });
        const body = request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.bytes), character => character.charCodeAt(0));
        return new Response(body, {
          headers: { 'Content-Type': asset.type, 'Cache-Control': 'no-cache', ...securityHeaders }
        });
      }
      if (!env.DB) return json({ error: '站点未配置 DB 数据库。' }, 503);
      const upload = pathname === '/api/room' && request.headers.get('Content-Type')?.startsWith('multipart/form-data;');
      const limit = upload ? maxReportRequestBytes : pathname === '/api/voice-sample' ? 160_044 : 30_000;
      if (Number(request.headers.get('Content-Length')) > limit) return json({ error: '请求过大。' }, 413);
      const settings = { ...env, SITES_SIGN_IN: true };
      try {
        if (pathname === '/api/admin/users' || pathname.startsWith('/api/admin/users/')) return await adminUsersApi(request, settings, env.DB);
        if (pathname === '/api/traffic' || pathname === '/api/admin/traffic') return await trafficApi(request, databaseTraffic(env.DB), settings);
        return await api(request, databaseStore(env.DB, databaseHistory(env.DB)), settings, databaseFriends(env.DB),
          databaseModeration(env.DB), request.headers.get('CF-Connecting-IP'), env.REPORT_FILES, databaseVoiceSamples(env.DB));
      } catch (error) {
        console.error('Sites request failed:', error.name);
        return json({ error: '服务暂时不可用，请稍后重试。' }, 503);
      }
    }
  };
}
