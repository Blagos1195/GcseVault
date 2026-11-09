CREATE TABLE IF NOT EXISTS revision_leaderboard (
  user_key TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  streak INTEGER NOT NULL DEFAULT 0 CHECK (streak >= 0),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS revision_leaderboard_rank_idx
ON revision_leaderboard(xp DESC, updated_at DESC);
