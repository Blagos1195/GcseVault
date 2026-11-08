CREATE TABLE IF NOT EXISTS account_credentials (
  user_key TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  recovery_wrapped_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_key) REFERENCES users(user_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account_sessions (
  token_hash TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_key) REFERENCES users(user_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS account_sessions_user_idx
ON account_sessions(user_key);

CREATE INDEX IF NOT EXISTS account_sessions_expiry_idx
ON account_sessions(expires_at);

CREATE TABLE IF NOT EXISTS encrypted_revision_data (
  user_key TEXT PRIMARY KEY,
  envelope_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_key) REFERENCES users(user_key) ON DELETE CASCADE
);
