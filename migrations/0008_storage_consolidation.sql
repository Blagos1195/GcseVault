ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN credential_created_at TEXT;
ALTER TABLE users ADD COLUMN credential_updated_at TEXT;
ALTER TABLE users ADD COLUMN revision_data_json TEXT;
ALTER TABLE users ADD COLUMN revision_updated_at TEXT;
ALTER TABLE users ADD COLUMN revision_xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN revision_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN revision_leaderboard_updated_at TEXT;

UPDATE users
SET password_hash = (SELECT password_hash FROM account_credentials WHERE account_credentials.user_key = users.user_key),
    password_salt = (SELECT password_salt FROM account_credentials WHERE account_credentials.user_key = users.user_key),
    credential_created_at = (SELECT created_at FROM account_credentials WHERE account_credentials.user_key = users.user_key),
    credential_updated_at = (SELECT updated_at FROM account_credentials WHERE account_credentials.user_key = users.user_key)
WHERE user_key IN (SELECT user_key FROM account_credentials);

UPDATE users
SET revision_data_json = (SELECT data_json FROM revision_sync_data WHERE revision_sync_data.user_key = users.user_key),
    revision_updated_at = (SELECT updated_at FROM revision_sync_data WHERE revision_sync_data.user_key = users.user_key)
WHERE user_key IN (SELECT user_key FROM revision_sync_data);

UPDATE users
SET revision_xp = (SELECT xp FROM revision_leaderboard WHERE revision_leaderboard.user_key = users.user_key),
    revision_streak = (SELECT streak FROM revision_leaderboard WHERE revision_leaderboard.user_key = users.user_key),
    revision_leaderboard_updated_at = (SELECT updated_at FROM revision_leaderboard WHERE revision_leaderboard.user_key = users.user_key)
WHERE user_key IN (SELECT user_key FROM revision_leaderboard);

CREATE TABLE IF NOT EXISTS kv_store (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER,
  metadata_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, key)
);

CREATE INDEX IF NOT EXISTS kv_store_expiry_idx ON kv_store(expires_at);

CREATE TABLE IF NOT EXISTS notifications (
  kind TEXT NOT NULL CHECK (kind IN ('admin', 'submission')),
  id TEXT NOT NULL,
  user_key TEXT NOT NULL,
  site TEXT NOT NULL,
  item_id TEXT NOT NULL,
  title TEXT NOT NULL,
  submitter TEXT,
  status TEXT,
  payload TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT,
  acknowledged_at TEXT,
  choice TEXT,
  PRIMARY KEY (kind, id)
);

INSERT OR IGNORE INTO notifications
(kind, id, user_key, site, item_id, title, submitter, created_at, read_at)
SELECT 'admin', id, user_key, site, item_id, title, submitter, created_at, read_at
FROM admin_notifications;

INSERT OR IGNORE INTO notifications
(kind, id, user_key, site, item_id, title, status, payload, created_at, acknowledged_at, choice)
SELECT 'submission', id, user_key, site, item_id, title, status, payload, created_at, acknowledged_at, choice
FROM submission_notifications;

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
ON notifications(kind, user_key, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_unread_idx
ON notifications(kind, user_key, read_at, created_at);

CREATE INDEX IF NOT EXISTS notifications_unacknowledged_idx
ON notifications(kind, user_key, acknowledged_at, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL CHECK (event_type IN ('moderation', 'account', 'test')),
  site TEXT,
  item_id TEXT,
  item_title TEXT,
  submitted_by TEXT,
  target_username TEXT,
  actor_username TEXT,
  action TEXT,
  test_name TEXT,
  status TEXT,
  detail TEXT,
  duration_ms INTEGER,
  acted_at TEXT NOT NULL
);

INSERT INTO audit_log
(event_type, site, item_id, item_title, submitted_by, actor_username, action, acted_at)
SELECT 'moderation', site, item_id, item_title, submitted_by, moderator, action, acted_at
FROM moderation_audit;

INSERT INTO audit_log
(event_type, target_username, actor_username, action, acted_at)
SELECT 'account', target_username, actor_username, action, acted_at
FROM admin_account_audit;

INSERT INTO audit_log
(event_type, actor_username, action, test_name, status, detail, duration_ms, acted_at)
SELECT 'test', actor_username, 'test_run', test_name, status, detail, duration_ms, completed_at
FROM test_run_history;

CREATE INDEX IF NOT EXISTS audit_log_type_time_idx
ON audit_log(event_type, acted_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_time_idx
ON audit_log(acted_at DESC);

INSERT OR IGNORE INTO kv_store (namespace, key, value, updated_at)
SELECT 'THEMES', 'theme:' || user_key || ':' || theme_key, theme_json, updated_at
FROM custom_themes;

INSERT OR IGNORE INTO kv_store (namespace, key, value, updated_at)
SELECT 'USER_DATA', 'course:' || user_key || ':' || site, selections_json, updated_at
FROM account_course_selections;

INSERT OR IGNORE INTO kv_store (namespace, key, value, updated_at)
SELECT 'USER_DATA', 'schedules:' || user_key || ':' || site, schedules_json, updated_at
FROM review_schedules;

INSERT OR IGNORE INTO kv_store (namespace, key, value, updated_at)
SELECT 'REVISION_SYNC_ORPHAN', user_key, data_json, updated_at
FROM revision_sync_data
WHERE user_key NOT IN (SELECT user_key FROM users);

INSERT OR IGNORE INTO kv_store (namespace, key, value, updated_at)
SELECT 'REVISION_LEADERBOARD_ORPHAN', user_key,
       json_object('username', username, 'xp', xp, 'streak', streak, 'updatedAt', updated_at),
       updated_at
FROM revision_leaderboard
WHERE user_key NOT IN (SELECT user_key FROM users);

DROP TABLE account_credentials;
DROP TABLE revision_sync_data;
DROP TABLE revision_leaderboard;
DROP TABLE custom_themes;
DROP TABLE account_course_selections;
DROP TABLE review_schedules;
DROP TABLE admin_notifications;
DROP TABLE submission_notifications;
DROP TABLE moderation_audit;
DROP TABLE admin_account_audit;
DROP TABLE test_run_history;
