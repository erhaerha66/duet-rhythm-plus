CREATE TABLE IF NOT EXISTS friend_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  first_id TEXT NOT NULL,
  second_id TEXT NOT NULL,
  sender INTEGER NOT NULL CHECK (sender IN (0, 1)),
  message_id TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  read_at INTEGER,
  UNIQUE (first_id, second_id, sender, message_id)
);
CREATE INDEX IF NOT EXISTS friend_message_history ON friend_messages (first_id, second_id, seq DESC);
CREATE INDEX IF NOT EXISTS friend_message_unread ON friend_messages (first_id, second_id, sender, seq) WHERE read_at IS NULL;
