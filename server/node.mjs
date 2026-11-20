import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { api, databaseStore, json, securityHeaders } from './game.mjs';
import { assetTypes } from './assets.mjs';
import { databaseTraffic, trafficApi } from './traffic.mjs';
import { databaseModeration } from './moderation.mjs';
import { maxReportRequestBytes } from '../public/report-files.js';
import { databaseHistory } from './history.mjs';
import { databaseFriends } from './friends.mjs';
import { databaseVoiceSamples } from './voice-samples.mjs';
import { adminUsersApi } from './admin-users.mjs';
import { createAdminAuth } from './admin-auth.mjs';
import { openStorage } from './storage.mjs';

export async function createApplication(config = process.env) {
  const publicOrigin = config.PUBLIC_ORIGIN && new URL(config.PUBLIC_ORIGIN);
  if (publicOrigin && (publicOrigin.protocol !== 'https:' || publicOrigin.href !== publicOrigin.origin + '/')) {
    throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without a path');
  }
  const directory = resolve(config.DATA_DIR ?? 'data');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const { db, bucket, close } = openStorage(directory);
  const auth = createAdminAuth(config);
  const settings = { ...config, ADMIN_EMAILS: auth.adminEmail, MODERATION_KEY: config.MODERATION_KEY ?? crypto.randomUUID() };
  const store = databaseStore(db, databaseHistory(db));
  const friends = databaseFriends(db);
  const traffic = databaseTraffic(db);
  const moderation = databaseModeration(db);
  const voiceSamples = databaseVoiceSamples(db);
  const server = createServer(async (incoming, outgoing) => {
    try {
      const { pathname, search } = new URL(incoming.url, 'http://local.invalid');
      let response;
      if (pathname.startsWith('/api/')) {
        const chunks = [];
        let size = 0;
        const upload = pathname === '/api/room' && incoming.headers['content-type']?.startsWith('multipart/form-data;');
        const limit = upload ? maxReportRequestBytes : pathname === '/api/voice-sample' ? 160_044 : 30_000;
        for await (const chunk of incoming) {
          size += chunk.length;
          if (size > limit) break;
          chunks.push(chunk);
        }
        if (size > limit) response = json({ error: '请求过大。' }, 413);
        else {
          const init = { method: incoming.method, headers: incoming.headers };
          if (size && !['GET', 'HEAD'].includes(incoming.method)) init.body = Buffer.concat(chunks);
          const origin = publicOrigin?.origin ?? 'http://' + incoming.headers.host;
          const request = new Request(origin + pathname + search, init);
          if (pathname === '/api/admin/login' || pathname === '/api/admin/logout') {
            response = await auth.handle(request, incoming.socket.remoteAddress);
          } else {
            const authenticated = new Request(request, { headers: auth.identityHeaders(request) });
            if (pathname === '/api/admin/users' || pathname.startsWith('/api/admin/users/')) {
              response = await adminUsersApi(authenticated, settings, db);
            } else if (pathname === '/api/traffic' || pathname === '/api/admin/traffic') {
              response = await trafficApi(authenticated, traffic, settings);
            } else {
              response = await api(authenticated, store, settings, friends, moderation,
                publicOrigin ? undefined : incoming.socket.remoteAddress, bucket, voiceSamples);
            }
          }
        }
      } else {
        const path = pathname === '/' ? '/index.html' : ['/admin', '/admin/'].includes(pathname) ? '/admin.html' : pathname;
        const type = Object.hasOwn(assetTypes, path) ? assetTypes[path] : null;
        if (!type || !['GET', 'HEAD'].includes(incoming.method)) response = new Response('找不到页面', { status: 404 });
        else {
          const body = await readFile(new URL(`../public${path}`, import.meta.url));
          response = new Response(incoming.method === 'HEAD' ? null : body, {
            headers: { 'Content-Type': type, 'Cache-Control': 'no-cache', ...securityHeaders }
          });
        }
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(bytes);
    } catch (error) {
      console.error('Request failed:', error.code ?? error.name);
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
    }
  });
  server.once('close', close);
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const server = await createApplication();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  server.listen(port, host, () => console.log(`双人节拍 · http://${host}:${server.address().port}`));
}
