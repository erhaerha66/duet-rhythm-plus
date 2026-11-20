export const reportReasons = ['骚扰或辱骂', '未经同意的行为', '垃圾信息或引流', '冒充身份', '其他'];
export const reportWindow = 2 * 60 * 60 * 1000;
const reportPageSize = 10;

function reportPage(requested, total) {
  const pages = Math.max(1, Math.ceil(total / reportPageSize));
  const page = Math.min(requested, pages);
  return { total, page, pages };
}
const reportEncoder = new TextEncoder();
const reportDecoder = new TextDecoder();
const reportKeys = new Map();

function encodedReport(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodedReport(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}

async function moderationKey(secret, kind) {
  const cacheKey = kind + secret;
  if (!reportKeys.has(cacheKey)) {
    const bytes = await crypto.subtle.digest('SHA-256', reportEncoder.encode(kind + ':' + secret));
    const key = kind === 'network'
      ? await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      : await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
    reportKeys.set(cacheKey, key);
  }
  return reportKeys.get(cacheKey);
}

export async function moderationNetwork(ip, secret) {
  if (!secret || !ip || !/^[\da-f.:]{3,45}$/i.test(ip)) return undefined;
  try {
    const address = ip.includes(':') ? new URL('http://[' + ip + ']/').hostname : ip;
    if (!ip.includes(':') && (ip.split('.').length !== 4 || new URL('http://' + ip).hostname !== ip)) return undefined;
    const key = await moderationKey(secret, 'network');
    return encodedReport(new Uint8Array(await crypto.subtle.sign('HMAC', key, reportEncoder.encode(address))));
  } catch {
    return undefined;
  }
}

export async function sealReportContext(secret, details) {
  const key = await moderationKey(secret, 'context');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const contents = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, reportEncoder.encode(JSON.stringify(details))));
  return encodedReport(Uint8Array.of(...iv, ...contents));
}

export async function openReportContext(secret, token, account, now) {
  if (typeof token !== 'string' || token.length > 1200 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const data = decodedReport(token);
    const key = await moderationKey(secret, 'context');
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) }, key, data.subarray(12));
    const context = JSON.parse(reportDecoder.decode(clear));
    return context.reporter === account && context.expires > now ? context : null;
  } catch {
    return null;
  }
}

export function databaseModeration(db, cache = {}) {
  return {
    async active(now) {
      if (cache.rows && now - cache.at < 8000) return cache.rows;
      try {
        const { results } = await db.prepare("SELECT target, target_network AS network, ban_until AS until FROM moderation_reports WHERE status = 'banned' AND ban_until > ?").bind(now).all();
        cache.at = now;
        cache.rows = results;
        return results;
      } catch (error) {
        if (cache.rows && /overload|too many resources|temporarily unavailable/i.test(error.message)) {
          cache.at = now - 6000;
          return cache.rows;
        }
        throw error;
      }
    },
    async add(report) {
      const { id, reporter, target, nickname, network, source, context, room, reason, detail, now, attachments = [] } = report;
      const row = await db.prepare(`INSERT INTO moderation_reports
        (id, reporter, target, target_name, target_network, source, context, room, reason, detail, created_at, status, attachments)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?13, ?14
        WHERE (SELECT COUNT(*) FROM moderation_reports WHERE reporter = ?2 AND created_at > ?12) < 8
        ON CONFLICT(reporter, target, context) DO NOTHING RETURNING id`)
        .bind(id, reporter, target, nickname, network ?? null, source, context, room ?? null, reason, detail, now, now - 3_600_000,
          attachments.length ? 'uploading' : 'pending', JSON.stringify(attachments)).first();
      return row?.id;
    },
    async finishUpload(id) {
      return !!(await db.prepare("UPDATE moderation_reports SET status = 'pending' WHERE id = ? AND status = 'uploading' RETURNING id").bind(id).first());
    },
    async cancelUpload(id) {
      return !!(await db.prepare("DELETE FROM moderation_reports WHERE id = ? AND status = 'uploading' RETURNING id").bind(id).first());
    },
    async recoverUpload(reporter, target, context, now) {
      const row = await db.prepare(`DELETE FROM moderation_reports
        WHERE reporter = ? AND target = ? AND context = ? AND status = 'uploading' AND created_at < ?
        RETURNING id, attachments`).bind(reporter, target, context, now - 300_000).first();
      return row && { ...row, attachments: JSON.parse(row.attachments) };
    },
    async file(id, index) {
      const row = await db.prepare("SELECT attachments FROM moderation_reports WHERE id = ? AND status <> 'uploading'").bind(id).first();
      return row && JSON.parse(row.attachments)[index];
    },
    async list(requested) {
      const { total } = await db.prepare("SELECT COUNT(*) AS total FROM moderation_reports WHERE status <> 'uploading'").first();
      const page = reportPage(requested, total);
      const { results } = await db.prepare(`SELECT id, target_name AS nickname, target_network IS NOT NULL AS hasNetwork,
        source, room, reason, detail, created_at AS createdAt, status, reviewed_at AS reviewedAt, ban_until AS banUntil, attachments
        FROM moderation_reports WHERE status <> 'uploading' ORDER BY (status = 'pending') DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`)
        .bind(reportPageSize, (page.page - 1) * reportPageSize).all();
      return { ...page, reports: results.map(row => ({ ...row, attachments: JSON.parse(row.attachments) })) };
    },
    async decide(id, action, reviewer, now, until) {
      const next = { dismiss: 'dismissed', ban: 'banned', unban: 'revoked' }[action];
      const row = await db.prepare(`UPDATE moderation_reports SET status = ?2, reviewed_by = ?3, reviewed_at = ?4, ban_until = ?5
        WHERE id = ?1 AND status = ?6 RETURNING status`)
        .bind(id, next, reviewer, now, until, action === 'unban' ? 'banned' : 'pending').first();
      if (row) cache.at = -Infinity;
      return row?.status;
    }
  };
}

export function memoryModeration() {
  const reports = new Map();
  return {
    active(now) {
      return [...reports.values()].filter(report => report.status === 'banned' && report.banUntil > now)
        .map(({ target, network, banUntil }) => ({ target, network, until: banUntil }));
    },
    add(report) {
      const mine = [...reports.values()].filter(row => row.reporter === report.reporter);
      if (mine.filter(row => row.now > report.now - 3_600_000).length >= 8 ||
        mine.some(row => row.target === report.target && row.context === report.context)) return;
      reports.set(report.id, { ...report, status: report.attachments?.length ? 'uploading' : 'pending' });
      return report.id;
    },
    finishUpload(id) {
      const report = reports.get(id);
      if (report?.status !== 'uploading') return false;
      report.status = 'pending';
      return true;
    },
    cancelUpload(id) {
      return reports.get(id)?.status === 'uploading' && reports.delete(id);
    },
    recoverUpload(reporter, target, context, now) {
      const report = [...reports.values()].find(row => row.reporter === reporter && row.target === target &&
        row.context === context && row.status === 'uploading' && row.now < now - 300_000);
      if (report) reports.delete(report.id);
      return report;
    },
    file(id, index) {
      const report = reports.get(id);
      return report?.status !== 'uploading' ? report?.attachments?.[index] : undefined;
    },
    decide(id, action, reviewer, now, until) {
      const report = reports.get(id);
      if (report?.status !== (action === 'unban' ? 'banned' : 'pending')) return;
      report.status = { dismiss: 'dismissed', ban: 'banned', unban: 'revoked' }[action];
      report.banUntil = until;
      return report.status;
    }
  };
}
