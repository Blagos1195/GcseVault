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
      get: async () => null,
      delete: async () => {}
    },
    DV_PENDING: {
      delete: async () => {}
    },
    THEMES: {
      put: async () => {},
      delete: async () => {},
      list: async () => ({ keys: [] }),
      get: async () => null
    }
  };
}

async function call(path, env, body) {
  const request = new Request("https://example.test" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
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
    pw: "test-admin",
    id: "quote-1"
  });

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
  const response = await call("/admin/users?token=test-session", env, {
    username: "student",
    role: "admin"
  });
  assert.equal(response.status, 200);
  assert.ok(env.updates.some(update => update.sql.includes("SET role = ?") && update.values[0] === "admin"));
});

test("revision sync verifies the account username", async () => {
  const env = makeEnv([{ username: "different-user" }]);
  env.REVISION = { get: async () => null, put: async () => {} };
  const response = await call("/revision/sync", env, {
    userKey: "account-key",
    username: "student",
    cards: []
  });
  assert.equal(response.status, 403);
});
