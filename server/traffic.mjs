import { json } from './game.mjs';
import { isSiteAdmin } from './watch.mjs';

const trafficDayMs = 86_400_000;
const trafficTimezoneOffset = 8 * 3_600_000;
const trafficId = /^[0-9a-f]{32}$/;
const siteDay = now => Math.floor((now + trafficTimezoneOffset) / trafficDayMs);
const siteDate = day => new Date(day * trafficDayMs).toISOString().slice(0, 10);
const trafficTotals = { views: 0, visitors: 0 };

export function databaseTraffic(db) {
  return {
    async record(day, browser, event) {
      await db.prepare('INSERT OR IGNORE INTO site_visits (day, visitor, event_id) VALUES (?, ?, ?)').bind(day, browser, event).run();
    },
    async report(start, end) {
      const [daily, totals, coverage] = await db.batch([
        db.prepare('SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM site_visits WHERE day BETWEEN ? AND ? GROUP BY day').bind(start, end),
        db.prepare('SELECT COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM site_visits WHERE day BETWEEN ? AND ?').bind(start, end),
        db.prepare('SELECT MIN(day) AS day FROM site_visits')
      ]);
      return { daily: daily.results, totals: totals.results[0], first: coverage.results[0].day };
    }
  };
}

export function memoryTraffic() {
  const visits = new Map();
  return {
    record(day, browser, event) {
      if (visits.has(event)) return;
      visits.set(event, { day, browser });
      for (const [id, visit] of visits) if (visit.day < day - 89) visits.delete(id);
    },
    report(start, end) {
      let first = null;
      let views = 0;
      const visitors = new Set();
      const counts = new Map();
      for (const { browser, day } of visits.values()) {
        first = first === null ? day : Math.min(day, first);
        if (day < start || day > end) continue;
        if (!counts.has(day)) counts.set(day, { views: 0, visitors: new Set() });
        const bucket = counts.get(day);
        bucket.views += 1;
        bucket.visitors.add(browser);
        views += 1;
        visitors.add(browser);
      }
      return { first, totals: { views, visitors: visitors.size }, daily: [...counts].map(([day, bucket]) => ({ day, views: bucket.views, visitors: bucket.visitors.size })) };
    }
  };
}

export async function trafficApi(request, traffic, settings, now = Date.now()) {
  const url = new URL(request.url);
  const end = siteDay(now);
  if (url.pathname === '/api/admin/traffic') {
    if (!isSiteAdmin(request, settings)) return json({ error: '请用获授权的 ChatGPT 账号登录。' }, 403);
    if (request.method !== 'GET') return json({ error: '请求方式无效。' }, 405);
    const days = url.searchParams.get('days') ?? '7';
    if (days !== '7' && days !== '30') return json({ error: '请选择近 7 天或近 30 天。' }, 400);
    const start = end - Number(days) + 1;
    const { daily, totals, first } = await traffic.report(start, end);
    const byDay = new Map(daily.map(({ day, views, visitors }) => [day, { views, visitors }]));
    const series = Array.from({ length: Number(days) }, (_, offset) => {
      const day = start + offset;
      const counted = first != null && day >= first;
      return { date: siteDate(day), counted, ...(counted ? byDay.get(day) ?? trafficTotals : { views: null, visitors: null }) };
    });
    return json({ firstDate: first == null ? null : siteDate(first), today: byDay.get(end) ?? trafficTotals, totals, daily: series });
  }

  if (request.method !== 'POST') return json({ error: '请求方式无效。' }, 405);
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if ((origin && origin !== url.origin) || (fetchSite && fetchSite !== 'same-origin')) return json({ error: '请从游戏页面发起请求。' }, 403);
  const payload = await request.text();
  if (payload.length > 400) return json({ error: '请求过大。' }, 413);
  let input;
  try { input = JSON.parse(payload); }
  catch { return json({ error: '请求无效。' }, 400); }
  const { browser, event } = input ?? {};
  if (typeof browser !== 'string' || !trafficId.test(browser) || typeof event !== 'string' || !trafficId.test(event)) {
    return json({ error: '请求无效。' }, 400);
  }
  const data = new TextEncoder().encode(`jianke-traffic:${browser}`);
  const key = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const visitor = Array.from(key, byte => byte.toString(16).padStart(2, '0')).join('');
  await traffic.record(end, visitor, event);
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
