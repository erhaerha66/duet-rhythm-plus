CREATE TABLE IF NOT EXISTS lobby_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL
);
INSERT OR IGNORE INTO lobby_state (id, payload) VALUES (1, '{"rooms":{},"queue":[]}');
