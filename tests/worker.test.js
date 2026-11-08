import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

function makeEnv(rows = []) {
  const updates = [];
  return {
    ADMIN_KEY: "test-admin",
    updates,
    DB: {
      prepare(sql) {
        return {
          first: async () => null,
          all: async () => ({ results: rows }),
          bind(...values) {
            return {
              first: async () => {
                if (sql.includes("SELECT user_key, username, role FROM users")) return { user_key: "admin-key", username: "owner", role: "owner" };
                if (sql.includes("SELECT user_key, role FROM users WHERE LOWER(username)")) return { user_key: "target-key", role: "user" };
                if (sql.includes("SELECT user_key FROM users WHERE role IN")) return null;
                if (sql.includes("SELECT user_key FROM users WHERE user_key")) return { user_key: values[0] };
                if (sql.includes("SELECT user_key FROM users WHERE role = 'owner'")) return null;
                return rows[0] || null;
              },
              all: async () => ({ results: rows }),
              run: async () => {
                updates.push({ sql, values });
                return { success: true, meta: { changes: 1 } };
              }
            };
          }
        };
      }
    },
    QUOTEVAULT: {
      get: async key => key === "session:test-session" ? JSON.stringify({ userKey: "admin-key" }) : null,
      delete: async () => {}
    },
    DV_PENDING: {
      delete: async () => {}
    },
    REVISION: {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
      list: async () => ({ keys: [], list_complete: true })
    },
    THEMES: {
      put: async () => {},
      delete: async () => {},
      list: async () => ({ keys: [] }),
      get: async () => null
    }
  };
}

async function call(path, env, body, extraHeaders = {}) {
  const request = new Request("https://example.test" + path, {
    method: body ? "POST" : "GET",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined
  });
  return worker.fetch(request, env);
}

test("public leaderboard never exposes account keys", async () => {
  const env = makeEnv([{
    user_key: "private-account-key",
    username: "student",
    qv_mastered: 12,
    dv_mastered: 4,
    qv_xp: 120,
    dv_xp: 40,
    streak: 3,
    max_streak: 5,
    updated_at: "2026-11-08T12:00:00.000Z"
  }]);

  const response = await call("/lb/list", env);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.users[0].username, "student");
  assert.equal("userKey" in data.users[0], false);
  assert.equal(JSON.stringify(data).includes("private-account-key"), false);
});

test("username lookup returns availability information without private account data", async () => {
  const env = makeEnv([{
    user_key: "private-account-key",
    username: "student",
    qv_pending_data: "[{\"private\":true}]"
  }]);

  const response = await call("/lb/get?username=student", env);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(data, { found: true, user: { username: "student" } });
});

test("leaderboard registration rejects unknown sites before database access", async () => {
  const env = makeEnv();
  env.DB.prepare = () => {
    throw new Error("Database should not be accessed");
  };

  const response = await call("/lb/register", env, {
    username: "student",
    site: "unknown",
    mastered: 0,
    xp: 0
  });

  assert.equal(response.status, 400);
  assert.equal(await response.text(), "Invalid site");
});

test("QuoteVault rejection updates QuoteVault pending IDs without clearing unrelated data", async () => {
  const env = makeEnv([{
    user_key: "account-key",
    qv_pending_ids: '["quote-1","quote-2"]',
    qv_rejected_ids: "[]"
  }]);

  const response = await call("/reject", env, {
    id: "quote-1"
  }, { "X-Session-Token": "test-session" });

  assert.equal(response.status, 200);
  assert.equal(env.updates.length, 1);
  assert.deepEqual(JSON.parse(env.updates[0].values[0]), ["quote-2"]);
  assert.deepEqual(JSON.parse(env.updates[0].values[1]), ["quote-1"]);
});

test("DateVault withdrawal cannot delete another user's pending submission", async () => {
  let deleted = false;
  const env = makeEnv([{
    user_key: "account-key",
    dv_pending_ids: '["owned-fact"]',
    dv_pending_data: "[]"
  }]);
  env.DV_PENDING.delete = async () => {
    deleted = true;
  };

  const response = await call("/dv/withdraw", env, {
    userKey: "account-key",
    id: "another-users-fact"
  });

  assert.equal(response.status, 403);
  assert.equal(deleted, false);
});

test("custom theme keys reject separators", async () => {
  let saved = false;
  const env = makeEnv();
  env.THEMES.put = async () => {
    saved = true;
  };

  const response = await call("/themes/save", env, {
    userKey: "account-key",
    key: "theme:other-user",
    theme: { label: "Test" }
  });

  assert.equal(response.status, 400);
  assert.equal(saved, false);
});

test("username availability allows the account owner to keep their own name", async () => {
  const env = makeEnv([{ user_key: "account-key" }]);

  const response = await call("/lb/username-available?username=student&userKey=account-key", env);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(data, { available: true });
});

test("username availability does not disclose another account key", async () => {
  const env = makeEnv([{ user_key: "account-key" }]);

  const response = await call("/lb/username-available?username=student&userKey=other-key", env);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(data, { available: false });
  assert.equal(JSON.stringify(data).includes("account-key"), false);
});

test("admin login does not accept the old shared password", async () => {
  const env = makeEnv();
  const response = await call("/auth", env, { pw: "test-admin" });
  assert.equal(response.status, 400);
});

test("owner bootstrap promotes the linked account", async () => {
  const env = makeEnv();
  const response = await call("/admin/bootstrap", env, {
    pw: "test-admin",
    userKey: "account-key"
  });
  assert.equal(response.status, 200);
  assert.ok(env.updates.some(update => update.sql.includes("SET role = 'owner'")));
});

test("owner can grant an account admin role", async () => {
  const env = makeEnv();
  const response = await call("/admin/users", env, {
    username: "student",
    role: "admin"
  }, { "X-Session-Token": "test-session" });
  assert.equal(response.status, 200);
  assert.ok(env.updates.some(update => update.sql.includes("SET role = ?") && update.values[0] === "admin"));
});

test("revision sync verifies the account username", async () => {
  const env = makeEnv([{ username: "different-user" }]);
  env.REVISION = { get: async key => key === "session:test-session" ? JSON.stringify({ userKey: "admin-key" }) : null, put: async () => {} };
  const response = await call("/revision/sync", env, {
    userKey: "account-key",
    username: "student",
    cards: []
  });
  assert.equal(response.status, 403);
});

test("username conflicts never disclose the existing account key", async () => {
  const env = makeEnv([{ user_key: "private-account-key" }]);
  const response = await call("/lb/register", env, {
    username: "student",
    site: "qv",
    mastered: 0,
    xp: 0
  });
  const data = await response.json();
  assert.equal(response.status, 409);
  assert.equal(data.error, "Username already taken");
  assert.equal("existingKey" in data, false);
  assert.equal(JSON.stringify(data).includes("private-account-key"), false);
});

test("admin sessions cannot be supplied in query strings", async () => {
  const env = makeEnv();
  const response = await call("/admin/users?token=test-session", env);
  assert.equal(response.status, 401);
});

test("theme storage rejects unknown accounts", async () => {
  const env = makeEnv();
  let listed = false;
  env.THEMES.list = async () => { listed = true; return { keys: [] }; };
  const response = await call("/themes/list?userKey=unknown", env);
  assert.equal(response.status, 404);
  assert.equal(listed, false);
});

test("owner migration copies existing revision data into D1 without deleting KV", async () => {
  const env = makeEnv();
  let legacyDeleted = false;
  env.REVISION.list = async () => ({ keys: [{ name: "user:account-key" }], list_complete: true });
  env.REVISION.get = async () => ({ username: "student", updatedAt: "2026-11-08T12:00:00.000Z", cards: [] });
  env.REVISION.delete = async () => { legacyDeleted = true; };
  const response = await call("/admin/migrate-storage", env, {
    phase: "revision",
    limit: 100
  }, { "X-Session-Token": "test-session" });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.migrated, 1);
  assert.equal(legacyDeleted, false);
  assert.ok(env.updates.some(update => update.sql.includes("revision_sync_data")));
});

test("theme migration preserves account keys containing separators", async () => {
  const env = makeEnv();
  env.THEMES.list = async () => ({ keys: [{ name: "theme:user:old-account:dark_theme" }], list_complete: true });
  env.THEMES.get = async () => ({ label: "Dark" });
  const response = await call("/admin/migrate-storage", env, {
    phase: "themes",
    limit: 100
  }, { "X-Session-Token": "test-session" });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.migrated, 1);
  assert.ok(env.updates.some(update => update.sql.includes("custom_themes") && update.values[0] === "user:old-account" && update.values[1] === "dark_theme"));
});
