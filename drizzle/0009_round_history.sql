CREATE TABLE IF NOT EXISTS round_history (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  player TEXT NOT NULL,
  segment TEXT NOT NULL,
  partner TEXT NOT NULL,
  partner_name TEXT NOT NULL,
  role TEXT NOT NULL,
  mode TEXT NOT NULL,
  elapsed INTEGER NOT NULL,
  marks INTEGER NOT NULL,
  partner_marks INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  UNIQUE (player, segment)
);
CREATE INDEX IF NOT EXISTS round_history_recent ON round_history(player, ended_at DESC, seq DESC);
CREATE INDEX IF NOT EXISTS round_history_partner ON round_history(player, partner, ended_at DESC, seq DESC);
