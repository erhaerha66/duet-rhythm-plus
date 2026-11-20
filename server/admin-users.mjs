import { guestAccount, json } from './game.mjs';
import { isSiteAdmin } from './watch.mjs';

const adminUserPageSize = 30;
const adminAccountPattern = /^[a-f0-9]{64}$/;
const adminUserSnapshots = `
  SELECT member.value AS player FROM lobby_state, json_each(payload, '$.online') AS member
  UNION ALL SELECT member.value FROM lobby_state, json_each(payload, '$.queue') AS member
  UNION ALL SELECT member.value FROM lobby_state, json_each(payload, '$.rooms') AS room, json_each(room.value, '$.players') AS member
  UNION ALL SELECT member.value FROM lobby_state, json_each(payload, '$.rooms') AS room, json_each(room.value, '$.waitlist') AS member
  UNION ALL SELECT member.value FROM lobby_state, json_each(payload, '$.rooms') AS room, json_each(room.value, '$.watch.viewers') AS member
    WHERE json_extract(member.value, '$.admin') IS NOT 1
`;

const adminUserDirectory = `WITH sources(account, nickname, seen) AS (
  SELECT json_extract(player, '$.account'), json_extract(player, '$.nickname'), json_extract(player, '$.seen')
    FROM (${adminUserSnapshots})
  UNION ALL SELECT player, NULL, ended_at FROM round_history
  UNION ALL SELECT partner, partner_name, ended_at FROM round_history
  UNION ALL SELECT first_id, first_name, created_at FROM friendships
  UNION ALL SELECT second_id, second_name, created_at FROM friendships
  UNION ALL SELECT target, target_name, created_at FROM moderation_reports
  UNION ALL SELECT reporter, NULL, created_at FROM moderation_reports
  UNION ALL SELECT first_id, NULL, MAX(sent_at) FROM friend_messages GROUP BY first_id
  UNION ALL SELECT second_id, NULL, MAX(sent_at) FROM friend_messages GROUP BY second_id
  UNION ALL SELECT account_id, NULL, NULL FROM friend_identity
  UNION ALL SELECT account, NULL, NULL FROM voice_samples
), ranked AS (
  SELECT account, nickname, MAX(seen) OVER (PARTITION BY account) AS activityAt,
    ROW_NUMBER() OVER (PARTITION BY account ORDER BY
      CASE WHEN nickname IS NULL OR nickname = '' OR nickname IN ('匿名玩家','游客') THEN 1 ELSE 0 END,
      seen DESC, nickname) AS rank
  FROM sources WHERE length(account) = 64 AND account NOT GLOB '*[^a-f0-9]*'
), directory AS (
  SELECT account, COALESCE(NULLIF(nickname, ''), '匿名玩家') AS nickname, COALESCE(activityAt, 0) AS activityAt
  FROM ranked WHERE rank = 1
)`;

class AdminUserStore {
  constructor(db) {
    this.db = db;
  }

  async indexBindings() {
    const { results } = await this.db.prepare('SELECT user_id, guest_key FROM friend_identity WHERE account_id IS NULL LIMIT 65').all();
    const writes = await Promise.all(results.slice(0, 64).map(async row => {
      const account = await guestAccount(row.guest_key);
      if (!account) return;
      return this.db.prepare('UPDATE friend_identity SET account_id = ? WHERE user_id = ? AND guest_key = ? AND account_id IS NULL')
        .bind(account, row.user_id, row.guest_key);
    }));
    const valid = writes.filter(Boolean);
    if (valid.length) await this.db.batch(valid);
    return results.length > 64;
  }

  async users(search, after, at) {
    const indexing = await this.indexBindings();
    const { results } = await this.db.prepare(`${adminUserDirectory}
      SELECT account, nickname, activityAt FROM directory
      WHERE (instr(lower(nickname), ?1) > 0 OR instr(account, ?1) = 1)
        AND (activityAt < ?2 OR (activityAt = ?2 AND account > ?3))
      ORDER BY activityAt DESC, account ASC LIMIT ${adminUserPageSize + 1}`)
      .bind(search, at, after).all();
    return { items: results.slice(0, adminUserPageSize), hasMore: results.length > adminUserPageSize, indexing };
  }

  async detail(account, before) {
    const [person, stats, rounds, friends, reports, profile] = await this.db.batch([
      this.db.prepare(`${adminUserDirectory} SELECT account, nickname, activityAt FROM directory WHERE account = ?`).bind(account),
      this.db.prepare(`SELECT
        (SELECT COUNT(*) FROM round_history WHERE player = ?1) AS rounds,
        (SELECT COUNT(*) FROM friend_messages WHERE (first_id = ?1 AND sender = 0) OR (second_id = ?1 AND sender = 1)) AS messagesSent,
        (SELECT COUNT(*) FROM friend_messages WHERE (first_id = ?1 AND sender = 1) OR (second_id = ?1 AND sender = 0)) AS messagesReceived,
        (SELECT COUNT(*) FROM moderation_reports WHERE target = ?1 AND status <> 'uploading') AS receivedReports,
        (SELECT COUNT(*) FROM moderation_reports WHERE reporter = ?1 AND status <> 'uploading') AS sentReports,
        EXISTS(SELECT 1 FROM friend_identity WHERE account_id = ?1) AS bound,
        EXISTS(SELECT 1 FROM voice_samples WHERE account = ?1) AS voiceSample`).bind(account),
      this.db.prepare(`SELECT seq, partner_name AS partnerName, role, mode, elapsed, marks, partner_marks AS partnerMarks, ended_at AS endedAt, outcome
        FROM round_history WHERE player = ? AND seq < ? ORDER BY seq DESC LIMIT ${adminUserPageSize + 1}`).bind(account, before),
      this.db.prepare(`SELECT CASE WHEN first_id = ?1 THEN second_name ELSE first_name END AS nickname,
        CASE WHEN accepted = 1 THEN 'friend' WHEN requester = ?1 THEN 'sent' ELSE 'received' END AS status, created_at AS createdAt
        FROM friendships WHERE first_id = ?1 OR second_id = ?1 ORDER BY accepted DESC, created_at DESC`).bind(account),
      this.db.prepare(`SELECT id, target_name AS targetName, reason, status, source, created_at AS createdAt, ban_until AS banUntil,
        CASE WHEN reporter = ?1 THEN 'sent' ELSE 'received' END AS direction
        FROM moderation_reports WHERE (target = ?1 OR reporter = ?1) AND status <> 'uploading' ORDER BY created_at DESC LIMIT 30`).bind(account),
      this.db.prepare(`SELECT json_extract(player, '$.publicGender') AS gender, json_extract(player, '$.profile.role') AS role,
        json_extract(player, '$.profile.voice') AS voice, json_extract(player, '$.seen') AS seen
        FROM (${adminUserSnapshots}) WHERE json_extract(player, '$.account') = ? ORDER BY seen DESC LIMIT 1`).bind(account)
    ]);
    if (!person.results.length) return;
    return {
      user: { ...person.results[0], ...stats.results[0], profile: profile.results[0] },
      rounds: rounds.results.slice(0, adminUserPageSize),
      hasOlder: rounds.results.length > adminUserPageSize,
      friends: friends.results,
      reports: reports.results
    };
  }
}

export async function adminUsersApi(request, settings, db) {
  if (!isSiteAdmin(request, settings)) return json({ error: '请使用获授权的 ChatGPT 账号登录。' }, 403);
  if (request.method !== 'GET') return json({ error: '请求方式无效。' }, 405);
  if (!db) return json({ error: '用户数据暂时不可用。' }, 503);
  const { pathname, searchParams } = new URL(request.url);
  const store = new AdminUserStore(db);
  if (pathname === '/api/admin/users') {
    const search = (searchParams.get('q') ?? '').trim().toLowerCase();
    const after = searchParams.get('after') ?? '';
    const at = Number(searchParams.get('at') ?? Number.MAX_SAFE_INTEGER);
    if (search.length > 64 || (after && !adminAccountPattern.test(after)) || !Number.isSafeInteger(at) || at < 0) {
      return json({ error: '用户查询参数无效。' }, 400);
    }
    return json(await store.users(search, after, at));
  }
  const account = pathname.slice('/api/admin/users/'.length);
  const before = Number(searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
  if (!adminAccountPattern.test(account) || !Number.isSafeInteger(before) || before < 1) return json({ error: '请选择有效的用户。' }, 400);
  const detail = await store.detail(account, before);
  return detail ? json(detail) : json({ error: '找不到这位用户。' }, 404);
}
