import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { api, memoryStore } from '../server/game.mjs';
import { databaseModeration } from '../server/moderation.mjs';
import { memoryReportBucket } from '../server/report-files.mjs';

test('reports verify their target and allow only moderators to apply a time-limited account and network ban', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(await readFile(new URL('../drizzle/0007_moderation_reports.sql', import.meta.url), 'utf8'));
  sqlite.exec(await readFile(new URL('../drizzle/0008_report_attachments.sql', import.meta.url), 'utf8'));
  const moderation = databaseModeration({
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bind = (...values) => ({
        first: async () => statement.get(...values),
        all: async () => ({ results: statement.all(...values) })
      });
      return { ...bind(), bind };
    }
  });
  let now = 70_000;
  t.mock.method(Date, 'now', () => now);
  const store = memoryStore();
  const bucket = memoryReportBucket();
  const put = bucket.put;
  let failUpload = false;
  bucket.put = async (key, contents) => {
    if (failUpload && key.endsWith('/1')) throw new Error('Test upload interrupted');
    await put(key, contents);
  };
  const settings = { MODERATION_KEY: 'test-only-key', ADMIN_EMAILS: 'moderator@example.test' };
  const origin = 'https://jianke.test';
  const run = async (path, headers, body, ip) => {
    const request = new Request(origin + path, { method: body ? 'POST' : 'GET',
      headers: { Origin: origin, ...headers }, body: body instanceof FormData ? body : body && JSON.stringify(body) });
    const response = await api(request, store, settings, undefined, moderation, ip, bucket);
    return { status: response.status, ...await response.json() };
  };
  const visitor = (key, ip, nickname) => {
    const id = crypto.randomUUID();
    return (action, values) => run('/api/room', {}, { id, guestKey: key.repeat(64), nickname, adult: true, action, ...values }, ip);
  };
  const host = visitor('a', '192.0.2.11', '甲');
  const peer = visitor('b', '2001:db8::14', '乙');
  const outsider = visitor('c', '192.0.2.13', '丙');
  const moderator = { 'oai-authenticated-user-id': 'operator', 'oai-authenticated-user-email': 'moderator@example.test' };
  const report = { reason: '其他', detail: '合成联调描述' };
  await peer('lobby', { visible: true });
  const target = (await host('lobby')).players.find(player => player.nickname === '乙').id;
  assert.equal((await host('report-player', { ...report, source: 'online', target })).status, 201);
  assert.equal((await host('report-player', { ...report, source: 'online', target })).status, 429);
  assert.equal((await host('report-player', { ...report, source: 'online', target: 'd'.repeat(64) })).status, 409);

  const { room: { code } } = await host('create');
  await peer('join', { code });
  const waiting = (await host('sync', { code })).room.report;
  assert.equal((await outsider('report-player', { ...report, source: 'room', token: waiting.token })).status, 409);
  assert.equal((await host('report-player', { ...report, source: 'room', token: waiting.token })).status, 201);
  await host('ready', { code, ready: true, watchOpen: true });
  const { room: { game } } = await peer('ready', { code, ready: true, watchOpen: true });
  const watchKey = (await outsider('lobby')).watchable[0].key;
  assert.equal((await outsider('report-player', { ...report, source: 'room-list', watchKey, role: 'receiver' })).status, 201);
  now = game.startAt + 1000;
  await peer('interaction', { code, round: game.id, kind: 'finish' });
  const resultToken = (await host('sync', { code })).room.report.token;
  await host('leave', { code });
  now += 40_000;
  await outsider('lobby');
  assert.equal((await host('sync', { code })).recentReport, undefined);
  const upload = new FormData();
  upload.set('payload', JSON.stringify({ id: crypto.randomUUID(), guestKey: 'a'.repeat(64), adult: true,
    action: 'report-player', source: 'result', token: resultToken, ...report }));
  upload.append('attachments', new File(['<svg onload="">'], '伪装.png', { type: 'image/png' }));
  assert.equal((await run('/api/room', {}, upload)).status, 400);
  upload.delete('attachments');
  upload.append('attachments', new File(['GIF89a'], 'incomplete.gif'));
  assert.equal((await run('/api/room', {}, upload)).status, 400);
  upload.delete('attachments');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD6kAAAAASUVORK5CYII=', 'base64');
  const video = Buffer.from('\0\0\0\u0018ftypmp42\0\0\0\0mp42isom\0\0\0\u0008moov');
  upload.append('attachments', new File([png], '截图.png'));
  upload.append('attachments', new File([video], '录屏.mp4'));
  failUpload = true;
  assert.equal((await run('/api/room', {}, upload)).status, 503);
  assert.equal((await run('/api/admin/reports', moderator)).reports.length, 3);
  failUpload = false;
  assert.equal((await run('/api/room', {}, upload)).status, 201);
  assert.equal((await run('/api/admin/reports', {})).status, 403);
  const { reports } = await run('/api/admin/reports', moderator);
  assert.equal(reports.length, 4);
  assert.ok(reports.every(item => item.nickname === '乙' && item.hasNetwork && !Object.hasOwn(item, 'target_network')));
  const item = reports.find(item => item.source === 'result');
  assert.deepEqual(item.attachments.map(file => file.type), ['image/png', 'video/mp4']);
  const id = item.id;
  const file = (index, headers) => api(new Request(`${origin}/api/admin/report-files/${id}/${index}`, { headers }),
    store, settings, undefined, moderation, undefined, bucket);
  assert.equal((await file(0)).status, 403);
  const image = await file(0, moderator);
  assert.equal(image.headers.get('Content-Type'), 'image/png');
  assert.equal(image.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  const chunk = await file(1, { ...moderator, Range: 'bytes=4-7' });
  assert.equal(chunk.status, 206);
  assert.equal(chunk.headers.get('Content-Range'), `bytes 4-7/${video.length}`);
  assert.equal(await chunk.text(), 'ftyp');
  const decision = { id, action: 'ban', minutes: 137 };
  assert.equal((await run('/api/admin/reports', {}, decision)).status, 403);
  for (const minutes of [0, 1.5, 525_601]) {
    assert.equal((await run('/api/admin/reports', moderator, { ...decision, minutes })).status, 400);
  }
  const ban = await run('/api/admin/reports', moderator, decision);
  assert.equal(ban.banUntil, now + decision.minutes * 60_000);
  const sameAccount = visitor('b', '192.0.2.40', '乙');
  const sameNetwork = visitor('e', '2001:0db8:0:0:0:0:0:14', '丁');
  for (const visit of [sameAccount, sameNetwork]) {
    const blocked = await visit('lobby');
    assert.equal(blocked.code, 'moderation-banned');
    assert.equal(blocked.banUntil, ban.banUntil);
  }
  assert.equal((await outsider('lobby')).status, 200);
  now = ban.banUntil - 1;
  assert.equal((await sameNetwork('lobby')).code, 'moderation-banned');
  now = ban.banUntil;
  for (const visit of [sameAccount, sameNetwork]) assert.equal((await visit('lobby')).status, 200);
});
