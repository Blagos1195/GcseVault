import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

test("D1 migrations apply in order and enforce key schema constraints", () => {
  const migrationDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
  const result = spawnSync("python3", ["-c", "import pathlib, sqlite3, sys\nroot = pathlib.Path(sys.argv[1])\ndb = sqlite3.connect(\":memory:\")\ndb.execute(\"PRAGMA foreign_keys = ON\")\ndb.execute(\"CREATE TABLE users (user_key TEXT PRIMARY KEY, username TEXT NOT NULL)\")\nfor migration in sorted(root.glob(\"*.sql\")):\n    db.executescript(migration.read_text())\ntables = {row[0] for row in db.execute(\"SELECT name FROM sqlite_master WHERE type='table'\")}\nrequired = {\"users\", \"revision_sync_data\", \"custom_themes\", \"admin_setup\", \"account_credentials\", \"account_sessions\", \"revision_leaderboard\"}\nmissing = required - tables\nif missing:\n    raise AssertionError(\"Missing migrated tables: \" + \", \".join(sorted(missing)))\ndb.executemany(\"INSERT INTO users (user_key, username) VALUES (?, ?)\", [(\"one\", \"one\"), (\"two\", \"two\")])\ndb.execute(\"UPDATE users SET role = 'owner' WHERE user_key = 'one'\")\ntry:\n    db.execute(\"UPDATE users SET role = 'owner' WHERE user_key = 'two'\")\nexcept sqlite3.IntegrityError:\n    pass\nelse:\n    raise AssertionError(\"The single-owner index did not reject a second owner\")\ntry:\n    db.execute(\"UPDATE users SET ai_access = 2 WHERE user_key = 'two'\")\nexcept sqlite3.IntegrityError:\n    pass\nelse:\n    raise AssertionError(\"The AI access constraint accepted an invalid value\")\ndb.execute(\"INSERT INTO revision_leaderboard (user_key, username, xp, streak, updated_at) VALUES ('one', 'one', 0, 0, '2026-01-01')\")\ndb.execute(\"INSERT INTO account_sessions (token_hash, user_key, created_at, expires_at) VALUES ('session', 'one', '2026-01-01', '2026-01-02')\")\nprint(\"All migrations applied in order; required tables and key constraints passed.\")\n", migrationDirectory], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout || "Migration validation failed");
  assert.match(result.stdout, /All migrations applied in order/);
});
