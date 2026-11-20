CREATE TABLE IF NOT EXISTS voice_relay_packets (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  voice_id TEXT NOT NULL,
  seat INTEGER NOT NULL CHECK (seat IN (0, 1)),
  packet TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS voice_relay_stream ON voice_relay_packets (voice_id, seat, seq);
CREATE INDEX IF NOT EXISTS voice_relay_expiry ON voice_relay_packets (created_at);

CREATE TRIGGER IF NOT EXISTS prune_relay_on_upload
AFTER INSERT ON voice_relay_packets
BEGIN
  DELETE FROM voice_relay_packets WHERE created_at <= NEW.created_at - 4000;
END;

CREATE TRIGGER IF NOT EXISTS prune_relay_on_lobby_update
AFTER UPDATE OF payload ON lobby_state
WHEN EXISTS (SELECT 1 FROM voice_relay_packets)
BEGIN
  DELETE FROM voice_relay_packets WHERE created_at <= CAST(unixepoch('subsec') * 1000 AS INTEGER) - 4000;
  DELETE FROM voice_relay_packets WHERE voice_id IN (
    SELECT json_extract(old_room.value, '$.voice.id')
    FROM json_each(OLD.payload, '$.rooms') AS old_room
    WHERE json_extract(old_room.value, '$.voice.relay.enabled') = 1
      AND json_extract(NEW.payload, '$.rooms.' || old_room.key || '.voice.id') IS NOT json_extract(old_room.value, '$.voice.id')
  );
END;
