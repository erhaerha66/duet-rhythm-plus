CREATE TABLE IF NOT EXISTS site_visits (
  event_id TEXT PRIMARY KEY NOT NULL,
  visitor TEXT NOT NULL,
  day INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS site_visits_by_day ON site_visits (day, visitor);

CREATE TRIGGER IF NOT EXISTS prune_old_site_visits
AFTER INSERT ON site_visits
BEGIN
  DELETE FROM site_visits WHERE day < NEW.day - 89;
END;
