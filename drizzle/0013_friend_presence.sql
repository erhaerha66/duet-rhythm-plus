CREATE TABLE IF NOT EXISTS friend_presence (
  account TEXT NOT NULL,
  tab TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (account, tab)
);

CREATE INDEX IF NOT EXISTS friend_presence_expiry ON friend_presence (expires_at);

CREATE TRIGGER IF NOT EXISTS prune_friend_presence
AFTER INSERT ON friend_presence
BEGIN
  DELETE FROM friend_presence WHERE expires_at < NEW.expires_at - 300000;
END;
