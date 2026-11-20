import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApplication } from '../server/node.mjs';
import { openStorage } from '../server/storage.mjs';

test('self-hosted reports are private, paginated beyond the legacy limit, and listening is unavailable', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'duet-test-'));
  const password = crypto.randomUUID();
  const { db, close } = openStorage(directory);
  try {
    const insert = db.prepare(`INSERT INTO moderation_reports
      (id, reporter, target, target_name, source, context, reason, detail, created_at, status)
      VALUES (?, ?, ?, ?, 'room', 'fixture', '其他', '测试', ?, ?)`);
    for (let index = 0; index < 103; index++) {
      insert.bind(crypto.randomUUID(), `reporter-${index}`, 'player', `样例 ${index}`, index,
        index === 102 ? 'uploading' : 'pending').run();
    }
  } finally {
    close();
  }
  const server = await createApplication({ ADMIN_PASSWORD: password, DATA_DIR: directory });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const reports = '/api/admin/reports';
  const forged = { 'oai-authenticated-user-id': 'fake', 'oai-authenticated-user-email': 'local-admin@example.invalid' };
  assert.equal((await fetch(origin + reports, { headers: forged })).status, 403);
  const login = await fetch(origin + '/api/admin/login', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  const headers = { Cookie: cookie.split(';')[0], Origin: origin };
  const front = await (await fetch(origin + reports, { headers })).json();
  const end = await (await fetch(origin + reports + '?page=11', { headers })).json();
  assert.deepEqual([front.page, front.pages, front.total, front.reports.length], [1, 11, 102, 10]);
  assert.deepEqual(end.reports.map(item => item.nickname), ['样例 1', '样例 0']);
  assert.equal((await fetch(origin + reports + '?page=0', { headers })).status, 400);
  assert.equal((await fetch(origin + '/api/admin/watch', { method: 'POST', headers })).status, 404);
  assert.equal((await fetch(origin + '/api/admin/logout', { method: 'POST', headers })).status, 200);
  assert.equal((await fetch(origin + reports, { headers })).status, 403);
});
