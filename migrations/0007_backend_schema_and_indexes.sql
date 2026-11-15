CREATE TABLE IF NOT EXISTS account_course_selections (
  user_key TEXT NOT NULL,
  site TEXT NOT NULL,
  selections_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_key, site)
);

CREATE TABLE IF NOT EXISTS review_schedules (
  user_key TEXT NOT NULL,
  site TEXT NOT NULL,
  schedules_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_key, site)
);

CREATE TABLE IF NOT EXISTS moderation_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_title TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  moderator TEXT NOT NULL,
  action TEXT NOT NULL,
  acted_at TEXT NOT NULL,
  UNIQUE (site, item_id, action)
);

CREATE TABLE IF NOT EXISTS submission_notifications (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  site TEXT NOT NULL,
  item_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  acknowledged_at TEXT,
  choice TEXT
);

CREATE TABLE IF NOT EXISTS admin_notifications (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  site TEXT NOT NULL,
  item_id TEXT NOT NULL,
  title TEXT NOT NULL,
  submitter TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
  user_key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_key, endpoint)
);

CREATE TABLE IF NOT EXISTS admin_account_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_username TEXT NOT NULL,
  actor_username TEXT NOT NULL,
  action TEXT NOT NULL,
  acted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS test_run_history (
  id TEXT PRIMARY KEY,
  actor_username TEXT NOT NULL,
  test_name TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_notifications_user_created_idx
ON admin_notifications(user_key, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_notifications_read_created_idx
ON admin_notifications(read_at, created_at);

CREATE INDEX IF NOT EXISTS submission_notifications_user_created_idx
ON submission_notifications(user_key, created_at);

CREATE INDEX IF NOT EXISTS submission_notifications_ack_created_idx
ON submission_notifications(acknowledged_at, created_at);

CREATE INDEX IF NOT EXISTS moderation_audit_acted_at_idx
ON moderation_audit(acted_at DESC);

CREATE INDEX IF NOT EXISTS admin_account_audit_acted_at_idx
ON admin_account_audit(acted_at DESC);

CREATE INDEX IF NOT EXISTS test_run_history_completed_at_idx
ON test_run_history(completed_at DESC);

CREATE INDEX IF NOT EXISTS admin_push_subscriptions_user_idx
ON admin_push_subscriptions(user_key);
