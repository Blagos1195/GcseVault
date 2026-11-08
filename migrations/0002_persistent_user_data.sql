CREATE TABLE IF NOT EXISTS revision_sync_data (
  user_key TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS revision_sync_updated_at_idx
ON revision_sync_data(updated_at);

CREATE TABLE IF NOT EXISTS custom_themes (
  user_key TEXT NOT NULL,
  theme_key TEXT NOT NULL,
  theme_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_key, theme_key)
);
