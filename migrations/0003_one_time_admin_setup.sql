CREATE TABLE IF NOT EXISTS admin_setup (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_key TEXT NOT NULL,
  used_at TEXT NOT NULL
);
