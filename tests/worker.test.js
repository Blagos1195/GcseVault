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
                if (sql.includes("SELECT user_key, role FROM users WHERE LOWER(username)")) return { user_key: "target-key", role: "user" };
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
    query = sql;
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
