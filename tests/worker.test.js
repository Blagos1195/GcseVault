import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";
import { webcrypto } from "node:crypto";


async function hashVerifier(value) {
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(value.toLowerCase()));
  return Buffer.from(digest).toString("hex");
}

async function derivePasswordHash(password, passwordSalt) {
  const saltBytes = Buffer.from(passwordSalt, "base64");
  const material = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: 600000 },
    material,
    256
  );
  return Buffer.from(bits).toString("hex");
}

function makeEnv(rows = []) {
  const updates = [];
  const batchCalls = [];
  return {
    ADMIN_KEY: "test-admin",
    updates,
    batchCalls,
    DB: {
      prepare(sql) {
        return {
          sql,
          first: async () => null,
          all: async () => ({ results: rows }),
          bind(...values) {
            return {
              first: async () => {
                if (sql.includes("FROM account_credentials")) return null;
                if (sql.includes("SELECT user_key FROM account_sessions WHERE token_hash")) return { user_key: "admin-key" };
                if (sql.includes("SELECT user_key, username, role FROM users")) return { user_key: "admin-key", username: "owner", role: "owner" };
                if (sql.includes("SELECT user_key, role FROM users WHERE LOWER(username)") || sql.includes("SELECT user_key, role, ai_access FROM users WHERE LOWER(username)")) return { user_key: "target-key", role: "user", ai_access: 0 };
                if (sql.includes("SELECT user_key FROM users WHERE role IN")) return null;
                if (sql.includes("SELECT user_key FROM users WHERE user_key")) return { user_key: values[0] };
                if (sql.includes("SELECT user_key FROM users WHERE role = 'owner'")) return null;
                return rows[0] || null;
              },
              sql,
              values,
              all: async () => ({ results: rows }),
              run: async () => {
                updates.push({ sql, values });
                return { success: true, meta: { changes: 1 } };
              }
            };
          }
        };
      },
      batch: async statements => {
        batchCalls.push(statements.map(statement => ({ sql: statement.sql, values: statement.values })));
        return statements.map(() => ({ success: true, meta: { changes: 1 } }));
      }
    },
    QUOTEVAULT: {
      get: async key => key === "session:test-session" ? JSON.stringify({ userKey: "admin-key", accountTokenHash: "test-account-session-hash" }) : null,
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

test("account-wide sign-out revokes every session for the authenticated account", async () => {
  const env = makeEnv();
  const updates = [];
  env.DB.prepare = sql => ({
    bind: (...values) => ({
      first: async () => sql.includes("FROM account_sessions s JOIN users") ? {
        user_key: "student-key",
        username: "student",
        role: "user"
      } : null,
      run: async () => {
        updates.push({ sql, values });
        return { success: true, meta: { changes: 3 } };
      }
    })
  });
  const denied = await worker.fetch(new Request("https://example.test/account/logout-all", { method: "POST" }), env);
  assert.equal(denied.status, 401);
  const response = await worker.fetch(new Request("https://example.test/account/logout-all", {
    method: "POST",
    headers: { "X-Account-Session": "a".repeat(64) }
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.deepEqual(updates, [{
    sql: "DELETE FROM account_sessions WHERE user_key = ?",
    values: ["student-key"]
  }]);
});

test("admin push subscriptions require an admin session and are stored per account", async () => {
  const env = makeEnv();
  const denied = await call("/admin/push/subscribe", env, {
    endpoint: "https://push.example/subscription",
    keys: { p256dh: "public-key", auth: "auth-key" }
  });
  assert.equal(denied.status, 401);

  const allowed = await call("/admin/push/subscribe", env, {
    endpoint: "https://push.example/subscription",
    keys: { p256dh: "public-key", auth: "auth-key" }
  }, { "X-Session-Token": "test-session" });
  assert.equal(allowed.status, 200);
  assert.ok(env.updates.some(update => update.sql.includes("INSERT INTO admin_push_subscriptions") && update.values[0] === "admin-key"));
});

test("submission notifications require the account session", async () => {
  const env = makeEnv();
  const response = await call("/submissions/notifications", env);
  assert.equal(response.status, 401);
});

test("approved content is exposed to admins for later removal", async () => {
  const env = makeEnv();
  env.PUBLIC_QUOTES = { list: async () => ({ keys: [], list_complete: true }), get: async () => null };
  env.DV_PUBLIC = { list: async () => ({ keys: [], list_complete: true }), get: async () => null };
  const response = await call("/admin/published", env, null, { "X-Session-Token": "test-session" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { quotes: [], dates: [] });
});

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

test("QuoteVault approval keeps the pending submission when D1 cleanup fails", async () => {
  const env = makeEnv();
  let pendingDeleted = false;
  let published = false;
  const row = {
    user_key: "account-key",
    qv_pending_ids: '["quote-1"]',
    qv_rejected_ids: "[]"
  };
  env.QUOTEVAULT.get = async key => key === "session:test-session"
    ? JSON.stringify({ userKey: "admin-key", accountTokenHash: "test-account-session-hash" })
    : key === "quote-1" ? { id: "quote-1", text: "A quote" } : null;
  env.QUOTEVAULT.delete = async key => { if (key === "quote-1") pendingDeleted = true; };
  env.PUBLIC_QUOTES = { put: async () => { published = true; } };
  env.DB.prepare = sql => ({
    bind: () => sql.includes("SELECT user_key FROM account_sessions WHERE token_hash")
      ? { first: async () => ({ user_key: "admin-key" }) }
      : sql.includes("SELECT user_key, username, role FROM users")
        ? { first: async () => ({ user_key: "admin-key", username: "owner", role: "owner" }) }
        : sql.startsWith("SELECT")
          ? { all: async () => ({ results: [row] }) }
          : { run: async () => { throw new Error("D1 unavailable"); } }
  });

  const response = await call("/approve", env, { id: "quote-1" }, { "X-Session-Token": "test-session" });

  assert.equal(response.status, 500);
  assert.equal(published, true);
  assert.equal(pendingDeleted, false);
});

test("DateVault rejection keeps the pending submission when D1 cleanup fails", async () => {
  const env = makeEnv();
  let pendingDeleted = false;
  const row = {
    user_key: "account-key",
    dv_pending_ids: '["fact-1"]',
    dv_rejected_ids: "[]"
  };
  env.QUOTEVAULT.get = async key => key === "session:test-session"
    ? JSON.stringify({ userKey: "admin-key", accountTokenHash: "test-account-session-hash" })
    : null;
  env.DV_PENDING.get = async key => key === "fact-1" ? { id: "fact-1", event: "A date" } : null;
  env.DV_PENDING.delete = async () => { pendingDeleted = true; };
  env.DB.prepare = sql => ({
    bind: () => sql.includes("SELECT user_key FROM account_sessions WHERE token_hash")
      ? { first: async () => ({ user_key: "admin-key" }) }
      : sql.includes("SELECT user_key, username, role FROM users")
        ? { first: async () => ({ user_key: "admin-key", username: "owner", role: "owner" }) }
        : sql.startsWith("SELECT")
          ? { all: async () => ({ results: [row] }) }
          : { run: async () => { throw new Error("D1 unavailable"); } }
  });

  const response = await call("/dv/reject", env, { id: "fact-1" }, { "X-Session-Token": "test-session" });

  assert.equal(response.status, 500);
  assert.equal(pendingDeleted, false);
});

test("QuoteVault rejection updates QuoteVault pending IDs without clearing unrelated data", async () => {
  const env = makeEnv([{
    user_key: "account-key",
    qv_pending_ids: '["quote-1","quote-2"]',
    qv_rejected_ids: "[]"
  }]);

  env.QUOTEVAULT.get = async key => key === "session:test-session" ? JSON.stringify({ userKey: "admin-key", accountTokenHash: "test-account-session-hash" }) : key === "quote-1" ? { id: "quote-1", text: "A quote" } : null;
  const response = await call("/reject", env, {
    id: "quote-1"
  }, { "X-Session-Token": "test-session" });

  assert.equal(response.status, 200);
  const userUpdate = env.updates.find(update => update.sql.includes("UPDATE users SET qv_pending_ids"));
  assert.ok(userUpdate);
  assert.deepEqual(JSON.parse(userUpdate.values[0]), ["quote-2"]);
  assert.deepEqual(JSON.parse(userUpdate.values[1]), ["quote-1"]);
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

  assert.equal(response.status, 401);
  assert.equal(deleted, false);
});

test("custom theme keys reject separators", async () => {
  let saved = false;
  const env = makeEnv();
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    const statement = prepare(sql);
    if (!sql.includes("FROM account_credentials") && !sql.includes("FROM account_sessions")) return statement;
    return {
      ...statement,
      bind(...values) {
        const bound = statement.bind(...values);
        return {
          ...bound,
          first: async () => sql.includes("FROM account_credentials")
            ? { user_key: values[0] }
            : { user_key: "account-key", username: "student", role: "user" }
        };
      }
    };
  };
  env.THEMES.put = async () => {
    saved = true;
  };

  const response = await call("/themes/save", env, {
    userKey: "account-key",
    key: "theme:other-user",
    theme: { label: "Test" }
  }, { "X-Account-Session": "a".repeat(64) });

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

test("owner bootstrap permanently claims the one-time setup lock", async () => {
  const env = makeEnv();
  const response = await call("/admin/bootstrap", env, {
    pw: "test-admin",
    userKey: "account-key"
  });
  assert.equal(response.status, 200);
  assert.equal(env.batchCalls.length, 1);
  assert.ok(env.batchCalls[0][0].sql.includes("INSERT OR IGNORE INTO admin_setup"));
  assert.ok(env.batchCalls[0][1].sql.includes("SET role = 'owner'"));
});

test("a second account cannot reuse the one-time admin key", async () => {
  const env = makeEnv();
  env.DB.batch = async statements => statements.map(() => ({ success: true, meta: { changes: 0 } }));
  const response = await call("/admin/bootstrap", env, {
    pw: "test-admin",
    userKey: "another-account-key"
  });
  assert.equal(response.status, 409);
  assert.equal(env.batchCalls.length, 0);
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

test("admin authentication requires a valid account session for the same user", async () => {
  const env = makeEnv();
  const denied = await call("/auth", env, { userKey: "admin-key" });
  assert.equal(denied.status, 401);
  let issued = false;
  env.QUOTEVAULT.put = async () => { issued = true; };
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    const statement = prepare(sql);
    if (!sql.includes("FROM account_sessions s JOIN users")) return statement;
    return { ...statement, bind: (...values) => ({ ...statement.bind(...values), first: async () => ({ user_key: "admin-key", username: "owner", role: "owner" }) }) };
  };
  const allowed = await call("/auth", env, { userKey: "admin-key" }, { "X-Account-Session": "a".repeat(64) });
  assert.equal(allowed.status, 200);
  assert.equal(issued, true);
});

test("AI login requires account authentication and explicit permission", async () => {
  const env = makeEnv();
  const denied = await call("/ai/auth", env, {});
  assert.equal(denied.status, 401);
  const token = "a".repeat(64);
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Buffer.from(digest).toString("hex");
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    const statement = prepare(sql);
    if (sql.includes("FROM account_sessions s JOIN users")) return { ...statement, bind: (...values) => ({ ...statement.bind(...values), first: async () => values[0] === tokenHash ? { user_key: "student-key", username: "student", role: "user" } : null }) };
    if (sql.includes("ai_access FROM users")) return { ...statement, bind: (...values) => ({ ...statement.bind(...values), first: async () => ({ user_key: "student-key", username: "student", role: "user", ai_access: 0 }) }) };
    return statement;
  };
  const noAccess = await call("/ai/auth", env, {}, { "X-Account-Session": token });
  assert.equal(noAccess.status, 403);
});

test("owner and admin inherit AI access while an owner can grant it to users", async () => {
  const env = makeEnv();
  const response = await call("/admin/ai-access", env, { username: "student", enabled: true }, { "X-Session-Token": "test-session" });
  assert.equal(response.status, 200);
  assert.ok(env.updates.some(update => update.sql.includes("SET ai_access = ?") && update.values[0] === 1));
});

test("AI logout deletes its session even when the linked account session is no longer valid", async () => {
  const env = makeEnv();
  let deletedKey = null;
  env.QUOTEVAULT.delete = async key => { deletedKey = key; };
  const response = await call("/ai/logout", env, {}, { "X-AI-Session": "expired-ai-token" });
  assert.equal(response.status, 200);
  assert.equal(deletedKey, "ai-session:expired-ai-token");
});

test("admins cannot issue AI access", async () => {
  const env = makeEnv();
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    const statement = prepare(sql);
    if (sql.includes("SELECT user_key, username, role FROM users")) return { ...statement, bind: (...values) => ({ ...statement.bind(...values), first: async () => ({ user_key: "admin-key", username: "admin", role: "admin" }) }) };
    return statement;
  };
  const response = await call("/admin/ai-access", env, { username: "student", enabled: true }, { "X-Session-Token": "test-session" });
  assert.equal(response.status, 403);
  assert.equal(env.updates.length, 0);
});
test("revision sync verifies the account username", async () => {
  const env = makeEnv([{ username: "different-user" }]);
  env.REVISION = { get: async key => key === "session:test-session" ? JSON.stringify({ userKey: "admin-key", accountTokenHash: "test-account-session-hash" }) : null, put: async () => {} };
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
  const originalPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    const statement = originalPrepare(sql);
    if (sql === "SELECT user_key FROM users WHERE user_key = ?") {
      return { ...statement, bind: (...values) => ({ ...statement.bind(...values), first: async () => null }) };
    }
    return statement;
  };
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

test("QuoteVault withdrawal requires an account key", async () => {
  let deleted = false;
  const env = makeEnv();
  env.QUOTEVAULT.delete = async () => { deleted = true; };
  const response = await call("/withdraw", env, { id: "quote-1" });
  assert.equal(response.status, 400);
  assert.equal(deleted, false);
});

test("admin logout requires the session header", async () => {
  let deleted = false;
  const env = makeEnv();
  env.QUOTEVAULT.delete = async () => { deleted = true; };
  const denied = await call("/auth/logout?token=test-session", env, {});
  assert.equal(denied.status, 401);
  assert.equal(deleted, false);
  const allowed = await call("/auth/logout", env, {}, { "X-Session-Token": "test-session" });
  assert.equal(allowed.status, 200);
  assert.equal(deleted, true);
});


test("password account setup hashes passwords, creates sessions and protects account-key endpoints", async () => {
  const env = makeEnv();
  const account = {
    user_key: "account-key",
    username: "student",
    role: "user",
    qv_mastered: 0,
    dv_mastered: 0,
    qv_xp: 0,
    dv_xp: 0,
    qv_mastered_ids: "[]",
    dv_mastered_ids: "[]",
    qv_pending_ids: "[]",
    dv_pending_ids: "[]",
    qv_pending_data: "[]",
    dv_pending_data: "[]",
    qv_rejected_ids: "[]",
    dv_rejected_ids: "[]",
    theme: "default"
  };
  let credential = null;
  const sessions = new Map();
  const kv = new Map();
  env.QUOTEVAULT.get = async key => kv.get(key) || null;
  env.QUOTEVAULT.put = async (key, value) => kv.set(key, value);
  env.QUOTEVAULT.delete = async key => kv.delete(key);
  env.DB.prepare = sql => ({
    bind(...values) {
      return {
        first: async () => {
          if (sql.includes("SELECT user_key FROM users WHERE user_key")) return values[0] === account.user_key ? { user_key: account.user_key } : null;
          if (sql.includes("SELECT user_key FROM account_credentials")) return credential ? { user_key: account.user_key } : null;
          if (sql.includes("SELECT username, role FROM users")) return { username: account.username, role: account.role };
          if (sql.includes("SELECT c.password_salt FROM users")) return credential ? { password_salt: credential.password_salt } : null;
          if (sql.includes("FROM users u JOIN account_credentials")) {
            return credential && values[0].toLowerCase() === account.username.toLowerCase()
              ? { ...account, password_hash: credential.password_hash, password_salt: credential.password_salt }
              : null;
          }
          if (sql.includes("FROM account_sessions s JOIN users")) {
            const session = sessions.get(values[0]);
            return session && session.expires_at > values[1]
              ? { user_key: account.user_key, username: account.username, role: account.role }
              : null;
          }
          if (sql.includes("SELECT * FROM users WHERE user_key")) return account;
          return null;
        },
        run: async () => {
          if (sql.includes("INSERT INTO account_credentials")) {
            credential = { password_hash: values[1], password_salt: values[2] };
          }
          if (sql.includes("INSERT INTO account_sessions")) {
            sessions.set(values[0], { user_key: values[1], expires_at: values[3] });
          }
          if (sql.includes("DELETE FROM account_sessions")) sessions.clear();
          return { success: true, meta: { changes: 1 } };
        },
        all: async () => ({ results: [] })
      };
    }
  });

  const passwordSalt = Buffer.from(webcrypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const passwordHash = await derivePasswordHash("a-unique-long-test-password", passwordSalt);
  const setup = await call("/account/setup", env, {
    userKey: account.user_key,
    passwordSalt,
    passwordHash
  });
  const setupData = await setup.json();
  assert.equal(setup.status, 200);
  assert.equal(setupData.userKey, account.user_key);
  assert.equal(credential.password_hash, await hashVerifier(passwordHash));
  assert.equal(credential.password_salt, passwordSalt);
  assert.equal(credential.password_hash.length, 64);

  const denied = await call("/lb/get?userKey=account-key", env);
  assert.equal(denied.status, 401);

  const challenge = await call("/account/challenge?username=student", env);
  const challengeData = await challenge.json();
  const loginHash = await derivePasswordHash("a-unique-long-test-password", challengeData.passwordSalt);
  const login = await call("/account/login", env, {
    username: account.username,
    passwordHash: loginHash
  });
  const loginData = await login.json();
  assert.equal(login.status, 200);
  assert.equal(loginData.userKey, account.user_key);

  const session = await call("/account/session", env, null, {
    "X-Account-Session": loginData.token
  });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).username, account.username);

  const allowed = await call("/lb/get?userKey=account-key", env, null, {
    "X-Account-Session": loginData.token
  });
  assert.equal(allowed.status, 200);

  const wrongHash = await derivePasswordHash("not-the-password", challengeData.passwordSalt);
  const wrongPassword = await call("/account/login", env, {
    username: account.username,
    passwordHash: wrongHash
  });
  assert.equal(wrongPassword.status, 401);
});


test("legacy accounts cannot update leaderboard stats before password setup", async () => {
  const env = makeEnv([{ user_key: "account-key", username: "student" }]);
  const response = await call("/lb/register", env, {
    userKey: "account-key",
    username: "student",
    site: "qv",
    mastered: 0,
    xp: 0
  });
  assert.equal(response.status, 401);
});

test("QuoteVault submissions require a password account", async () => {
  const env = makeEnv([{ user_key: "account-key" }]);
  const response = await call("/submit", env, {
    userKey: "account-key",
    text: "A submitted quote"
  });
  assert.equal(response.status, 401);
});

test("DateVault submissions require a password account", async () => {
  const env = makeEnv([{ user_key: "account-key" }]);
  const response = await call("/dv/submit", env, {
    userKey: "account-key",
    event: "A submitted fact"
  });
  assert.equal(response.status, 401);
});

test("Revision publication requires a password account", async () => {
  const env = makeEnv([{ user_key: "account-key" }]);
  const response = await call("/revision/public", env, {
    userKey: "account-key",
    note: { title: "Revision notes", cards: [] }
  });
  assert.equal(response.status, 401);
});


test("Revision leaderboard reads from D1", async () => {
  const env = makeEnv();
  let query = "";
  env.DB.prepare = sql => {
    if (sql.includes("PRAGMA table_info(users)")) return { all: async () => ({ results: [{ name: "leaderboard_hidden" }] }) };
    if (sql.includes("FROM revision_leaderboard")) query = sql;
    return { all: async () => ({ results: [{ username: "student", xp: 420, streak: 3, updatedAt: "2026-11-09T08:00:00.000Z" }] }) };
  };
  env.REVISION.list = async () => {
    throw new Error("Revision leaderboard should not read KV");
  };

  const response = await call("/revision/leaderboard", env);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.ok(query.includes("FROM revision_leaderboard"));
  assert.deepEqual(data.users, [{ username: "student", xp: 420, streak: 3, updatedAt: "2026-11-09T08:00:00.000Z" }]);
});

test("owner migration copies legacy Revision leaderboard entries into D1 without deleting KV", async () => {
  const env = makeEnv();
  let legacyDeleted = false;
  env.REVISION.list = async ({ prefix }) => {
    assert.equal(prefix, "leaderboard:");
    return { keys: [{ name: "leaderboard:account-key" }], list_complete: true };
  };
  env.REVISION.get = async () => ({
    userKey: "account-key",
    username: "student",
    xp: 420,
    streak: 3,
    updatedAt: "2026-11-09T08:00:00.000Z"
  });
  env.REVISION.delete = async () => { legacyDeleted = true; };

  const response = await call("/admin/migrate-storage", env, {
    phase: "revision-leaderboard",
    limit: 100
  }, { "X-Session-Token": "test-session" });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.migrated, 1);
  assert.equal(legacyDeleted, false);
  assert.ok(env.updates.some(update => update.sql.includes("INSERT OR IGNORE INTO revision_leaderboard")));
});


test("owner migration reports malformed Revision leaderboard records as skipped", async () => {
  const env = makeEnv();
  env.REVISION.list = async () => ({
    keys: [{ name: "leaderboard:invalid-account" }],
    list_complete: true
  });
  env.REVISION.get = async () => ({
    userKey: "invalid-account",
    username: "",
    xp: -1,
    streak: 0
  });

  const response = await call("/admin/migrate-storage", env, {
    phase: "revision-leaderboard",
    limit: 100
  }, { "X-Session-Token": "test-session" });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.processed, 1);
  assert.equal(data.migrated, 0);
  assert.equal(data.alreadyPresent, 0);
  assert.equal(data.skipped, 1);
  assert.equal(data.complete, true);
  assert.equal(data.cursor, null);
});

test("owner migration counts existing D1 records separately from newly copied records", async () => {
  const env = makeEnv();
  env.REVISION.list = async () => ({
    keys: [{ name: "leaderboard:account-key" }],
    list_complete: true
  });
  env.REVISION.get = async () => ({
    userKey: "account-key",
    username: "student",
    xp: 420,
    streak: 3,
    updatedAt: "2026-11-09T08:00:00.000Z"
  });
  env.DB.prepare = sql => ({
    bind: () => ({
      first: async () => sql.includes("SELECT user_key FROM account_sessions WHERE token_hash")
        ? { user_key: "admin-key" }
        : sql.includes("SELECT user_key, username, role FROM users")
          ? { user_key: "admin-key", username: "owner", role: "owner" }
          : null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true, meta: { changes: 0 } })
    })
  });

  const response = await call("/admin/migrate-storage", env, {
    phase: "revision-leaderboard",
    limit: 100
  }, { "X-Session-Token": "test-session" });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.processed, 1);
  assert.equal(data.migrated, 0);
  assert.equal(data.alreadyPresent, 1);
  assert.equal(data.skipped, 0);
});


test("automatic bug feedback is stored with bounded diagnostic metadata", async () => {
  const env = makeEnv();
  const saved = new Map();
  env.FEEDBACK = {
    put: async (id, value) => saved.set(id, JSON.parse(value))
  };
  env.QUOTEVAULT.put = async () => {};
  const response = await call("/feedback/submit", env, {
    type: "Automatic bug report",
    title: "TypeError: test failure",
    description: "Automatically captured JavaScript error.\\nStack: test.js:1",
    sourceApplication: "Revision",
    errorName: "TypeError",
    errorStack: "TypeError: test failure\\n at test.js:1",
    errorLocation: "test.js:1:2",
    fingerprint: "abc123",
    page: "/GcseVault/revision/"
  });
  assert.equal(response.status, 200);
  const record = [...saved.values()][0];
  assert.equal(record.type, "Automatic bug report");
  assert.equal(record.sourceApplication, "Revision");
  assert.equal(record.errorName, "TypeError");
  assert.equal(record.fingerprint, "abc123");
  assert.equal(record.page, "/GcseVault/revision/");
});

test("review schedule routes authenticate and always scope writes to the signed-in account", async () => {
  const env = makeEnv([{ user_key: "account-key", username: "student" }]);
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    const statement = prepare(sql);
    const bind = statement.bind;
    statement.bind = (...values) => {
      const bound = bind(...values);
      if (sql.includes("SELECT s.user_key, u.username, u.role FROM account_sessions")) {
        bound.first = async () => ({ user_key: "account-key", username: "student", role: "user" });
      } else if (sql.includes("FROM account_credentials")) {
        bound.first = async () => ({ user_key: "account-key" });
      } else if (sql.includes("SELECT schedules_json FROM review_schedules")) {
        bound.first = async () => null;
      }
      return bound;
    };
    return statement;
  };
  const denied = await call("/review-schedules?site=qv", env);
  assert.equal(denied.status, 401);
  const token = "a".repeat(64);
  const saved = await call("/review-schedules", env, {
    site: "qv",
    userKey: "different-account",
    schedules: { cardA: { due: "2026-11-12", updatedAt: "2026-11-11T10:00:00.000Z" } }
  }, { "X-Account-Session": token });
  assert.equal(saved.status, 200);
  assert.ok(env.updates.some(update => update.sql.includes("INSERT INTO review_schedules") && update.values[0] === "account-key" && update.values[1] === "qv"));
});


test("progress summary is account-scoped and returns aggregates without study content", async () => {
  const env = makeEnv();
  const token = "a".repeat(64);
  const schedules = {
    qv: { quote1: { due: "2026-11-12" }, quote2: { due: "2026-11-20" } },
    dv: { date1: { due: "2026-11-13" } }
  };
  const revisionData = {
    accountSets: [
      { id: "set-a", cards: [{ id: "card-a" }, { id: "card-b" }], progress: { "card-a": { reviews: 2, due: Date.now() + 86400000 } }, xp: 120 },
      { id: "set-b", cards: [{ id: "card-c" }], progress: { "card-c": { reviews: 1, due: Date.now() - 1000 } }, xp: 40 }
    ]
  };
  env.DB.prepare = sql => ({
    bind: (...values) => ({
      first: async () => {
        if (sql.includes("FROM account_sessions s JOIN users")) return { user_key: "account-key", username: "student", role: "user" };
        if (sql.includes("FROM account_credentials")) return { user_key: "account-key" };
        if (sql.includes("SELECT schedules_json, updated_at FROM review_schedules")) return { schedules_json: JSON.stringify(schedules[values[1]] || {}), updated_at: "2026-11-13T10:00:00.000Z" };
        if (sql.includes("SELECT data_json, updated_at FROM revision_sync_data")) return { data_json: JSON.stringify(revisionData), updated_at: "2026-11-13T11:00:00.000Z" };
        return null;
      },
      all: async () => ({ results: [] }),
      run: async () => ({ success: true, meta: { changes: 0 } })
    })
  });
  const denied = await call("/account/progress-summary", env);
  assert.equal(denied.status, 401);
  const response = await call("/account/progress-summary", env, null, { "X-Account-Session": token });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.account.username, "student");
  assert.equal(data.quoteVault.scheduled, 2);
  assert.equal(data.quoteVault.due, 1);
  assert.equal(data.dateVault.scheduled, 1);
  assert.equal(data.dateVault.due, 1);
  assert.equal(data.revision.sets, 2);
  assert.equal(data.revision.cards, 3);
  assert.equal(data.revision.reviewed, 2);
  assert.equal(data.revision.xp, 160);
  assert.equal("accountSets" in data, false);
  assert.equal("cards" in data, false);
});

test("submission approval replaces existing private copies instead of duplicating them", async () => {
  const env = makeEnv();
  const updates = [];
  const existing = [
    { id: "quote-1", text: "Older local copy" },
    { id: "quote-1", text: "Duplicate local copy" },
    { id: "quote-2", text: "Unrelated quote" }
  ];
  env.DB.prepare = sql => ({
    bind: (...values) => ({
      first: async () => {
        if (sql.includes("FROM account_sessions s JOIN users")) return { user_key: "account-key", username: "student", role: "user" };
        if (sql.includes("FROM submission_notifications")) return {
          site: "qv",
          item_id: "quote-1",
          status: "approved",
          payload: JSON.stringify({
            original: { id: "quote-1", text: "Original quote" },
            approved: { id: "quote-1", text: "Edited quote" }
          })
        };
        if (sql.includes("SELECT qv_pending_data, qv_rejected_ids")) return {
          qv_pending_data: JSON.stringify(existing),
          qv_rejected_ids: "[]"
        };
        return null;
      },
      run: async () => {
        updates.push({ sql, values });
        return { success: true, meta: { changes: 1 } };
      }
    })
  });

  const response = await call("/submissions/notifications/resolve", env, {
    id: "qv:quote-1:approved",
    choice: "replace"
  }, { "X-Account-Session": "a".repeat(64) });

  assert.equal(response.status, 200);
  const saved = updates.find(update => update.sql.includes("UPDATE users SET qv_pending_data"));
  assert.ok(saved);
  const pending = JSON.parse(saved.values[0]);
  assert.equal(pending.filter(item => String(item.id) === "quote-1").length, 1);
  assert.equal(pending.find(item => String(item.id) === "quote-1").text, "Edited quote");
  assert.equal(pending.some(item => item.id === "quote-2"), true);
});

test("feedback submissions enforce a per-IP rate limit", async () => {
  const env = makeEnv();
  let saved = false;
  env.QUOTEVAULT.get = async key => key.startsWith("feedback-submit:") ? "5" : null;
  env.FEEDBACK = { put: async () => { saved = true; } };

  const response = await call("/feedback/submit", env, {
    type: "Bug report",
    title: "Test",
    description: "Test description"
  }, { "CF-Connecting-IP": "192.0.2.1" });

  assert.equal(response.status, 429);
  assert.equal(saved, false);
});


test("QuoteVault submission, approval and publication complete as one Worker lifecycle", async () => {
  const studentToken = "a".repeat(64);
  const ownerToken = "b".repeat(64);
  const studentHash = await hashVerifier(studentToken);
  const ownerHash = await hashVerifier(ownerToken);
  const pending = new Map();
  const published = new Map();
  const notifications = [];
  const moderation = [];
  const env = makeEnv();
  env.QUOTEVAULT.get = async key => {
    if (key === "session:owner-session") return JSON.stringify({ userKey: "owner-key", accountTokenHash: ownerHash });
    if (!pending.has(key)) return null;
    return JSON.parse(pending.get(key));
  };
  env.QUOTEVAULT.put = async (key, value) => pending.set(key, value);
  env.QUOTEVAULT.delete = async key => pending.delete(key);
  env.PUBLIC_QUOTES = {
    put: async (key, value) => published.set(key, JSON.parse(value)),
    get: async key => published.get(key) || null
  };
  env.DB.prepare = sql => {
    const statement = values => ({
      bind: (...next) => statement(next),
      first: async () => {
        if (sql.includes("FROM account_credentials")) return values[0] === "student-key" ? { user_key: "student-key" } : null;
        if (sql.includes("FROM account_sessions s JOIN users")) {
          if (values[0] === studentHash) return { user_key: "student-key", username: "student", role: "user" };
          return null;
        }
        if (sql.includes("SELECT user_key FROM account_sessions WHERE token_hash")) {
          return values[0] === ownerHash ? { user_key: "owner-key" } : null;
        }
        if (sql.includes("SELECT user_key, username, role FROM users")) {
          return values[0] === "owner-key" ? { user_key: "owner-key", username: "owner", role: "owner" } : null;
        }
        if (sql.includes("FROM submission_notifications WHERE user_key")) {
          return notifications.find(item => item.user_key === values[0] && item.acknowledged_at == null) || null;
        }
        return null;
      },
      all: async () => {
        if (sql.includes("SELECT id, site, item_id, title, status, payload, created_at FROM submission_notifications")) {
          return { results: notifications.filter(item => item.user_key === values[0] && item.acknowledged_at == null) };
        }
        return { results: [] };
      },
      run: async () => {
        if (sql.includes("INSERT OR IGNORE INTO submission_notifications")) {
          notifications.push({
            id: values[0], user_key: values[1], site: values[2], item_id: values[3],
            title: values[4], status: values[5], payload: values[6], created_at: values[7],
            acknowledged_at: null
          });
        }
        if (sql.includes("INSERT OR IGNORE INTO moderation_audit")) {
          moderation.push({
            site: values[0], item_id: values[1], item_title: values[2],
            submitted_by: values[3], moderator: values[4], action: values[5]
          });
        }
        return { success: true, meta: { changes: 1 } };
      }
    });
    return statement([]);
  };

  const submitted = await call("/submit", env, {
    userKey: "student-key",
    text: "A synthetic quote for the lifecycle test",
    char: "Test character",
    work: "Test work"
  }, { "X-Account-Session": studentToken });
  assert.equal(submitted.status, 200);
  const submission = await submitted.json();
  assert.ok(submission.id);
  assert.ok(pending.has(submission.id));

  const approved = await call("/approve", env, { id: submission.id }, { "X-Session-Token": "owner-session" });
  assert.equal(approved.status, 200);
  assert.equal(pending.has(submission.id), false);
  assert.equal(published.get(submission.id).text, "A synthetic quote for the lifecycle test");
  assert.equal(published.get(submission.id)._submittedByUserKey, undefined);

  const updates = await call("/submissions/notifications", env, null, { "X-Account-Session": studentToken });
  assert.equal(updates.status, 200);
  const updateData = await updates.json();
  assert.equal(updateData.notifications.length, 1);
  assert.equal(updateData.notifications[0].item_id, submission.id);
  assert.equal(updateData.notifications[0].status, "approved");
  assert.equal(updateData.notifications[0].payload.original.text, "A synthetic quote for the lifecycle test");

  assert.equal(moderation.length, 1);
  assert.equal(moderation[0].action, "approved");
  assert.equal(moderation[0].moderator, "owner");
});


test("owner Test Centre stores run history and restricts history access", async () => {
  const env = makeEnv();
  const writes = [];
  const originalPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    const statement = originalPrepare(sql);
    const originalBind = statement.bind;
    statement.bind = (...values) => {
      const bound = originalBind(...values);
      if (sql.includes("SELECT actor_username")) bound.all = async () => ({ results: [{ actor_username: "owner", test_name: "permissions", status: "passed", detail: "Owner-only access check passed.", duration_ms: 1, completed_at: "2026-11-13T12:00:00.000Z" }] });
      if (sql.includes("INSERT INTO test_run_history")) bound.run = async () => { writes.push({sql,values}); return {success:true,meta:{changes:1}}; };
      return bound;
    };
    return statement;
  };
  const run = await call("/admin/test-run", env, {test:"permissions"}, {"X-Session-Token":"test-session"});
  assert.equal(run.status,200);
  assert.ok(writes.some(write=>write.sql.includes("INSERT INTO test_run_history")&&write.values[1]==="owner"&&write.values[2]==="permissions"));
  const denied = await call("/admin/test-history",env);
  assert.equal(denied.status,401);
  const history = await call("/admin/test-history",env,null,{"X-Session-Token":"test-session"});
  assert.equal(history.status,200);
  assert.equal((await history.json()).history[0].test_name,"permissions");
});

test("owner Test Centre verifies migration-managed tables and account columns", async () => {
  const env = makeEnv();
  const originalPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    const statement = originalPrepare(sql);
    const originalBind = statement.bind;
    statement.bind = (...values) => {
      const bound = originalBind(...values);
      if (sql.includes("sqlite_master")) bound.all = async () => ({results:values.map(name=>({name}))});
      if (sql.includes("PRAGMA table_info(users)")) bound.all = async () => ({results:[{name:"role"},{name:"ai_access"}]});
      return bound;
    };
    return statement;
  };
  const response = await call("/admin/test-run",env,{test:"migrations"},{"X-Session-Token":"test-session"});
  const data = await response.json();
  assert.equal(response.status,200);
  assert.equal(data.results[0].status,"passed");
  assert.match(data.results[0].detail,/six migration-managed tables/);
});

test("Test Centre reports missing migrations without changing the database", async () => {
  const env = makeEnv();
  const originalPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    const statement = originalPrepare(sql);
    const originalBind = statement.bind;
    statement.bind = (...values) => {
      const bound = originalBind(...values);
      if (sql.includes("sqlite_master")) bound.all = async () => ({results:[{name:"account_sessions"}]});
      if (sql.includes("PRAGMA table_info(users)")) bound.all = async () => ({results:[{name:"role"}]});
      return bound;
    };
    return statement;
  };
  const response = await call("/admin/test-run",env,{test:"migrations"},{"X-Session-Token":"test-session"});
  const data = await response.json();
  assert.equal(response.status,200);
  assert.equal(data.results[0].status,"failed");
  assert.match(data.results[0].detail,/missing tables/);
  assert.match(data.results[0].detail,/ai_access/);
  assert.equal(env.updates.some(update=>/revision_sync_data|custom_themes|account_credentials|account_sessions|revision_leaderboard|ALTER TABLE/.test(update.sql)),false);
});

test("admin status exposes Worker version metadata without account information", async () => {
  const env = makeEnv();
  env.CF_VERSION_METADATA = {id:"version-123",tag:"production",timestamp:"2026-11-13T12:00:00.000Z"};
  const response = await call("/admin/status",env);
  const data = await response.json();
  assert.equal(response.status,200);
  assert.equal(data.initialized,false);
  assert.deepEqual(data.deployment,{versionId:"version-123",tag:"production",timestamp:"2026-11-13T12:00:00.000Z"});
  assert.equal(data.userKey,undefined);
});

test("admin status handles deployments without version metadata", async () => {
  const env = makeEnv();
  const response = await call("/admin/status",env);
  const data = await response.json();
  assert.equal(response.status,200);
  assert.equal(data.deployment,null);
});


test("account login rejects oversized request bodies", async () => {
  const env = makeEnv();
  const response = await worker.fetch(new Request("https://example.test/account/login", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({username:"student",passwordHash:"a".repeat(5000)})
  }),env);
  assert.equal(response.status,413);
});

test("account setup rate limiting blocks repeated attempts before database access", async () => {
  const env = makeEnv();
  env.QUOTEVAULT.get = async () => "5";
  env.DB.prepare = () => { throw new Error("Database should not be accessed after the rate limit is reached"); };
  const response = await worker.fetch(new Request("https://example.test/account/setup", {
    method:"POST",
    headers:{"Content-Type":"application/json","CF-Connecting-IP":"203.0.113.10"},
    body:JSON.stringify({userKey:"account-key"})
  }),env);
  assert.equal(response.status,429);
});

test("content submissions enforce size limits and account rate limits", async () => {
  const oversizedEnv = makeEnv();
  const oversized = await worker.fetch(new Request("https://example.test/submit", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({text:"x".repeat(20000)})
  }),oversizedEnv);
  assert.equal(oversized.status,413);

  const limitedEnv = makeEnv();
  limitedEnv.QUOTEVAULT.get = async key => key.startsWith("quote-submit:") ? "10" : null;
  limitedEnv.DB.prepare = sql => ({
    bind: () => ({
      first: async () => {
        if (sql.includes("FROM account_credentials")) return {user_key:"student-key"};
        if (sql.includes("FROM account_sessions s JOIN users")) return {user_key:"student-key",username:"student",role:"user"};
        return null;
      }
    })
  });
  const limited = await worker.fetch(new Request("https://example.test/submit", {
    method:"POST",
    headers:{"Content-Type":"application/json","X-Account-Session":"a".repeat(64),"CF-Connecting-IP":"203.0.113.11"},
    body:JSON.stringify({userKey:"student-key",text:"A test quote"})
  }),limitedEnv);
  assert.equal(limited.status,429);
});


test("owner account permission changes are written to the admin audit log", async () => {
  const env = makeEnv();
  const writes = [];
  env.DB.prepare = sql => ({
    bind: (...values) => ({
      first: async () => {
        if (sql.includes("SELECT user_key FROM account_sessions WHERE token_hash")) return { user_key: "admin-key" };
        if (sql.includes("SELECT user_key, username, role FROM users WHERE user_key")) return { user_key: "admin-key", username: "owner", role: "owner" };
        if (sql.includes("SELECT user_key, role FROM users WHERE LOWER(username)") || sql.includes("SELECT user_key, role, ai_access FROM users WHERE LOWER(username)")) return { user_key: "target-key", role: "user", ai_access: 0 };
        return null;
      },
      all: async () => ({ results: [] }),
      run: async () => { writes.push({ sql, values }); return { success: true, meta: { changes: 1 } }; }
    })
  });
  const response = await worker.fetch(new Request("https://example.test/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Session-Token": "test-session" },
    body: JSON.stringify({ username: "student", role: "admin" })
  }), env);
  assert.equal(response.status, 200);
  assert.ok(writes.some(write => write.sql.includes("INSERT INTO admin_account_audit") &&
    write.values[0] === "student" && write.values[1] === "owner" &&
    write.values[2] === "Role changed from user to admin"));
});


test("QuoteVault submission retries reuse the same server item and admin notification", async () => {
  const env = makeEnv();
  const storage = new Map();
  const notices = new Set();
  let puts = 0;
  const basePrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    const statement = basePrepare(sql);
    const baseBind = statement.bind;
    statement.bind = (...values) => {
      const bound = baseBind(...values);
      if (sql.includes("FROM account_credentials")) bound.first = async () => ({ user_key: "student-key" });
      if (sql.includes("account_sessions s JOIN users u")) bound.first = async () => ({ user_key: "student-key", username: "student", role: "user" });
      if (sql.includes("INSERT OR IGNORE INTO admin_notifications")) bound.run = async () => {
        const key = values[0];
        const changes = notices.has(key) ? 0 : 1;
        notices.add(key);
        return { meta: { changes } };
      };
      return bound;
    };
    if (sql.includes("SELECT user_key FROM users WHERE role IN")) statement.all = async () => ({ results: [{ user_key: "owner-key" }] });
    return statement;
  };
  env.QUOTEVAULT.get = async (key, type) => {
    if (key === "session:test-session") return JSON.stringify({ userKey: "admin-key", accountTokenHash: "test-account-session-hash" });
    const value = storage.get(key);
    return type === "json" && value ? JSON.parse(value) : value || null;
  };
  env.QUOTEVAULT.put = async (key, value) => { if (!key.startsWith("quote-submit:")) puts++; storage.set(key, value); };
  const body = { userKey: "student-key", submissionRequestId: "8f7e6d5c-4b3a-2910-8f7e-6d5c4b3a2910", text: "A test quote", char: "A character" };
  const headers = { "X-Account-Session": "a".repeat(64) };
  const first = await call("/submit", env, body, headers);
  const second = await call("/submit", env, body, headers);
  const firstData = await first.json();
  const secondData = await second.json();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(firstData.id, secondData.id);
  assert.equal(puts, 1);
  assert.equal(notices.size, 1);
});

test("DateVault submission retries reuse the same server item", async () => {
  const env = makeEnv();
  const storage = new Map();
  let puts = 0;
  const basePrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    const statement = basePrepare(sql);
    const baseBind = statement.bind;
    statement.bind = (...values) => {
      const bound = baseBind(...values);
      if (sql.includes("FROM account_credentials")) bound.first = async () => ({ user_key: "student-key" });
      if (sql.includes("account_sessions s JOIN users u")) bound.first = async () => ({ user_key: "student-key", username: "student", role: "user" });
      return bound;
    };
    if (sql.includes("SELECT user_key FROM users WHERE role IN")) statement.all = async () => ({ results: [] });
    return statement;
  };
  env.QUOTEVAULT.put = async () => {};
  env.DV_PENDING = {
    get: async (key, type) => { const value = storage.get(key); return type === "json" && value ? JSON.parse(value) : value || null; },
    put: async (key, value) => { puts++; storage.set(key, value); }
  };
  const body = { userKey: "student-key", submissionRequestId: "9f8e7d6c-5b4a-3921-9f8e-7d6c5b4a3921", event: "A test date" };
  const headers = { "X-Account-Session": "b".repeat(64) };
  const first = await call("/dv/submit", env, body, headers);
  const second = await call("/dv/submit", env, body, headers);
  const firstData = await first.json();
  const secondData = await second.json();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(firstData.id, secondData.id);
  assert.equal(puts, 1);
});

test("QuoteVault rejects malformed idempotency request IDs", async () => {
  const env = makeEnv();
  env.QUOTEVAULT.put = async () => {};
  const basePrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    const statement = basePrepare(sql);
    const baseBind = statement.bind;
    statement.bind = (...values) => {
      const bound = baseBind(...values);
      if (sql.includes("FROM account_credentials")) bound.first = async () => ({ user_key: "student-key" });
      if (sql.includes("account_sessions s JOIN users u")) bound.first = async () => ({ user_key: "student-key", username: "student", role: "user" });
      return bound;
    };
    return statement;
  };
  const response = await call("/submit", env, {
    userKey: "student-key",
    submissionRequestId: "invalid",
    text: "A test quote"
  }, { "X-Account-Session": "c".repeat(64) });
  assert.equal(response.status, 400);
});
