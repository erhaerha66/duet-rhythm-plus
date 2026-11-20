import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSitesWorker } from '../server/sites.mjs';
import { openStorage } from '../server/storage.mjs';

test('Sites Worker runs the shared lobby and protects admin and friend identity routes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'duet-worker-'));
  const { db, bucket, close } = openStorage(directory);
  t.after(async () => {
    close();
    await rm(directory, { recursive: true });
  });
  const worker = createSitesWorker({ '/index.html': { type: 'text/html', bytes: btoa('<h1>Test</h1>') } });
  const env = { DB: db, REPORT_FILES: bucket, ADMIN_EMAILS: 'admin@example.test' };
  const admin = { 'oai-authenticated-user-id': 'test-admin', 'oai-authenticated-user-email': 'admin@example.test' };
  const origin = 'https://play.example.test';
  const request = (path, init) => worker.fetch(new Request(origin + path, init), env);
  const page = await request('/');
  assert.equal(await page.text(), '<h1>Test</h1>');
  assert.match(page.headers.get('permissions-policy'), /microphone=\(self\)/);
  assert.equal((await request('/api/admin/reports')).status, 403);
  assert.equal((await request('/api/admin/reports', { headers: admin })).status, 200);
  assert.equal((await request('/api/admin/watch', { method: 'POST', headers: admin })).status, 404);
  const player = nickname => {
    const id = crypto.randomUUID();
    const guestKey = id.replaceAll('-', '').repeat(2);
    return async (action, fields = {}) => {
      const response = await request('/api/room', {
        method: 'POST', body: JSON.stringify({ id, guestKey, nickname, adult: true, action, ...fields })
      });
      assert.ok(response.ok, `${action}: ${await response.clone().text()}`);
      return response.json();
    };
  };
  const host = player('公开搭档');
  const peer = player('练习搭档');
  const viewer = player('观众');
  await host('lobby', { visible: true });
  assert.ok((await peer('lobby')).players.some(person => person.nickname === '公开搭档'));
  const { room: { code } } = await host('create');
  await peer('join', { code });
  await host('ready', { code, ready: true, watchOpen: true });
  assert.deepEqual((await (await request('/api/active-rooms')).json()).rooms, []);
  await peer('ready', { code, ready: true, watchOpen: true });
  const { rooms: [{ key }] } = await (await request('/api/active-rooms')).json();
  const watching = await viewer('watch-join', { key });
  assert.equal(watching.state, 'watching');
  assert.equal(watching.room.listen, 'off');
  await host('watch-open', { code, open: false });
  assert.equal((await viewer('watch-sync', { key })).state, 'watch-closed');
  assert.deepEqual(await (await request('/api/friend-identity')).json(),
    { signedIn: false, syncAvailable: true, sitesSignIn: true });
});
