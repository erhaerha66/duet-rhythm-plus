import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { databaseTraffic, memoryTraffic, trafficApi } from '../server/traffic.mjs';

const origin = 'https://jianke.test';
const allowed = 'operator@example.test';
const settings = { ADMIN_EMAILS: allowed };
const identity = { 'oai-authenticated-user-id': 'fixture', 'oai-authenticated-user-email': allowed };
const eventId = value => value.toString(16).padStart(32, '0');

async function sqliteTraffic(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(await readFile(new URL('../drizzle/0003_site_visits.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bind = (...values) => ({ all: () => ({ results: statement.all(...values) }), run: () => statement.run(...values) });
      return { ...bind(), bind };
    },
    batch: async statements => statements.map(statement => statement.all())
  };
  return databaseTraffic(db);
}

for (const backend of ['memory', 'D1']) {
  test(`${backend} visit statistics deduplicate page retries and returning browsers across Beijing days`, async t => {
    const store = backend === 'D1' ? await sqliteTraffic(t) : memoryTraffic();
    const now = Date.parse('2026-11-19T16:05:00Z');
    const visit = (browser, event, time = now, source = origin) => trafficApi(new Request(`${origin}/api/traffic`, {
      method: 'POST', headers: { Origin: source, 'Content-Type': 'application/json' },
      body: JSON.stringify({ browser: eventId(browser), event: eventId(event) })
    }), store, settings, time);
    const report = (days = 7, headers = identity) => trafficApi(new Request(`${origin}/api/admin/traffic?days=${days}`, { headers }), store, settings, now);

    assert.equal((await report(7, {})).status, 403);
    assert.equal((await report(7, { ...identity, 'oai-authenticated-user-email': 'visitor@example.test' })).status, 403);
    assert.equal((await report(365)).status, 400);
    const empty = await (await report()).json();
    assert.equal(empty.firstDate, null);
    assert.ok(empty.daily.every(day => day.views === null && !day.counted));
    assert.equal((await visit(1, 10, now - 600_000)).status, 204);
    assert.equal((await visit(1, 10)).status, 204);
    assert.equal((await visit(1, 11)).status, 204);
    assert.equal((await visit(2, 12)).status, 204);
    assert.equal((await visit(3, 13, now, 'https://other.test')).status, 403);

    const result = await report();
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    const data = await result.json();
    assert.equal(data.firstDate, '2026-11-19');
    assert.deepEqual(data.today, { views: 2, visitors: 2 });
    assert.deepEqual(data.totals, { views: 3, visitors: 2 });
    assert.deepEqual(data.daily.slice(-3), [
      { date: '2026-11-18', counted: false, views: null, visitors: null },
      { date: '2026-11-19', counted: true, views: 1, visitors: 1 },
      { date: '2026-11-20', counted: true, views: 2, visitors: 2 }
    ]);
    assert.equal((await (await report(30)).json()).daily.length, 30);
  });
}
