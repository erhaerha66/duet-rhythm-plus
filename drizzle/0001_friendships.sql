CREATE TABLE IF NOT EXISTS friendships (
  first_id TEXT NOT NULL,
  second_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  second_name TEXT NOT NULL,
  requester TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (first_id, second_id)
);
CREATE INDEX IF NOT EXISTS friendships_second_id ON friendships (second_id);
