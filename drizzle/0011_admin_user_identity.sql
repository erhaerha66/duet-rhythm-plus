ALTER TABLE friend_identity ADD COLUMN account_id TEXT;
CREATE INDEX IF NOT EXISTS friend_identity_account ON friend_identity(account_id);
CREATE INDEX IF NOT EXISTS moderation_report_target ON moderation_reports(target, created_at DESC);
CREATE INDEX IF NOT EXISTS friend_messages_second ON friend_messages(second_id, sent_at DESC);
