CREATE TABLE IF NOT EXISTS moderation_reports (
  id TEXT PRIMARY KEY NOT NULL,
  reporter TEXT NOT NULL,
  target TEXT NOT NULL,
  target_name TEXT NOT NULL,
  target_network TEXT,
  source TEXT NOT NULL,
  context TEXT NOT NULL,
  room TEXT,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at INTEGER,
  ban_until INTEGER,
  UNIQUE(reporter, target, context)
);
CREATE INDEX IF NOT EXISTS moderation_report_rate ON moderation_reports(reporter, created_at);
CREATE INDEX IF NOT EXISTS moderation_report_status ON moderation_reports(status, created_at);
CREATE INDEX IF NOT EXISTS moderation_active_bans ON moderation_reports(ban_until) WHERE status = 'banned';
