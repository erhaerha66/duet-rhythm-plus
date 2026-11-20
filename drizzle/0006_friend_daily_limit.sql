ALTER TABLE friendships ADD COLUMN accepted_day INTEGER;

CREATE TABLE IF NOT EXISTS friend_daily_adds (
  day INTEGER NOT NULL,
  account TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, account)
);

CREATE TRIGGER IF NOT EXISTS enforce_friend_daily_limit
BEFORE UPDATE OF accepted ON friendships
WHEN OLD.accepted = 0 AND NEW.accepted = 1 AND NEW.accepted_day IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'friend_daily_limit') WHERE EXISTS (
    SELECT 1 FROM friend_daily_adds
    WHERE day = NEW.accepted_day AND account IN (NEW.first_id, NEW.second_id) AND total >= 2
  );
END;

CREATE TRIGGER IF NOT EXISTS count_friend_daily_add
AFTER UPDATE OF accepted ON friendships
WHEN OLD.accepted = 0 AND NEW.accepted = 1 AND NEW.accepted_day IS NOT NULL
BEGIN
  INSERT INTO friend_daily_adds (day, account, total)
  VALUES (NEW.accepted_day, NEW.first_id, 1), (NEW.accepted_day, NEW.second_id, 1)
  ON CONFLICT(day, account) DO UPDATE SET total = total + 1;
  DELETE FROM friend_daily_adds WHERE day < NEW.accepted_day - 7;
END;
