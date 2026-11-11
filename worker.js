export default {
  async fetch(request, env) {

    const url = new URL(request.url);

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Session-Token, X-Account-Session, X-AI-Session"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const ADMIN_KEY = env.ADMIN_KEY;

    async function getSessionUser(reqUrl, req) {
      const token = req.headers.get("X-Session-Token");
      if (!token) return null;
      const stored = await env.QUOTEVAULT.get("session:" + token);
      if (!stored) return null;
      let session;
      try { session = JSON.parse(stored); } catch { return null; }
      if (!session.userKey || !session.accountTokenHash) return null;
      const accountSession = await env.DB.prepare(
        "SELECT user_key FROM account_sessions WHERE token_hash = ? AND expires_at > ?"
      ).bind(session.accountTokenHash, new Date().toISOString()).first();
      if (!accountSession || accountSession.user_key !== session.userKey) return null;
      const user = await env.DB.prepare(
        "SELECT user_key, username, role FROM users WHERE user_key = ?"
      ).bind(session.userKey).first();
      if (!user || !["owner", "admin"].includes(user.role)) return null;
      return { ...user, token };
    }

    async function isAuthorized(reqUrl, req) {
      return Boolean(await getSessionUser(reqUrl, req));
    }

    async function getAIUser(req) {
      const token = req.headers.get("X-AI-Session");
      if (!token) return null;
      const stored = await env.QUOTEVAULT.get("ai-session:" + token);
      if (!stored) return null;
      let session;
      try { session = JSON.parse(stored); } catch { return null; }
      if (!session.userKey || !session.accountTokenHash) return null;
      const accountSession = await env.DB.prepare(
        "SELECT user_key FROM account_sessions WHERE token_hash = ? AND expires_at > ?"
      ).bind(session.accountTokenHash, new Date().toISOString()).first();
      if (!accountSession || accountSession.user_key !== session.userKey) return null;
      const user = await env.DB.prepare(
        "SELECT user_key, username, role, ai_access FROM users WHERE user_key = ?"
      ).bind(session.userKey).first();
      if (!user || (!["owner", "admin"].includes(user.role) && Number(user.ai_access) !== 1)) return null;
      return { ...user, token };
    }

    async function updateModerationRecords(site, id, rejected) {
      const pendingColumn = site === "qv" ? "qv_pending_ids" : "dv_pending_ids";
      const rejectedColumn = site === "qv" ? "qv_rejected_ids" : "dv_rejected_ids";
      const { results } = await env.DB.prepare(
        `SELECT user_key, ${pendingColumn}, ${rejectedColumn} FROM users WHERE ${pendingColumn} LIKE ?`
      ).bind(`%${id}%`).all();

      for (const row of results) {
        const pendingIds = JSON.parse(row[pendingColumn] || "[]").map(String);
        if (!pendingIds.includes(id)) continue;
        const rejectedIds = JSON.parse(row[rejectedColumn] || "[]").map(String).filter(value => value !== id);
        if (rejected) rejectedIds.push(id);
        await env.DB.prepare(
          `UPDATE users SET ${pendingColumn}=?, ${rejectedColumn}=?, updated_at=? WHERE user_key=?`
        ).bind(
          JSON.stringify(pendingIds.filter(value => value !== id)),
          JSON.stringify([...new Set(rejectedIds)]),
          new Date().toISOString(),
          row.user_key
        ).run();
      }
    }

    async function getSubmissionOwners(site) {
      const column = site === "qv" ? "qv_pending_ids" : "dv_pending_ids";
      const { results } = await env.DB.prepare(
        `SELECT username, ${column} AS pending_ids FROM users WHERE ${column} IS NOT NULL AND ${column} != '[]'`
      ).all();
      const owners = new Map();
      for (const row of results) {
        let ids = [];
        try { ids = JSON.parse(row.pending_ids || "[]").map(String); } catch {}
        for (const id of ids) owners.set(id, row.username);
      }
      return owners;
    }

    async function ensureLeaderboardVisibilityColumn() {
      const columns = await env.DB.prepare("PRAGMA table_info(users)").all();
      if (!columns.results.some(column => column.name === "leaderboard_hidden")) await env.DB.prepare("ALTER TABLE users ADD COLUMN leaderboard_hidden INTEGER NOT NULL DEFAULT 0").bind().run();
    }

    async function ensureModerationTables() {
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS moderation_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, item_id TEXT NOT NULL, item_title TEXT NOT NULL, submitted_by TEXT NOT NULL, moderator TEXT NOT NULL, action TEXT NOT NULL, acted_at TEXT NOT NULL, UNIQUE(site, item_id, action))").bind().run();
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS submission_notifications (id TEXT PRIMARY KEY, user_key TEXT NOT NULL, site TEXT NOT NULL, item_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, acknowledged_at TEXT, choice TEXT)").bind().run();
    }
    async function attachSubmissionOwner(site, id, item) {
      const pendingColumn = site === "qv" ? "qv_pending_ids" : "dv_pending_ids";
      const { results } = await env.DB.prepare("SELECT user_key, username, " + pendingColumn + " AS pending_ids FROM users WHERE " + pendingColumn + " LIKE ?").bind("%" + id + "%").all();
      for (const row of results || []) {
        let ids = [];
        try { ids = JSON.parse(row.pending_ids || "[]").map(String); } catch {}
        if (!ids.includes(String(id))) continue;
        item._submittedByUserKey = item._submittedByUserKey || row.user_key;
        item.submittedBy = item.submittedBy || row.username;
        return row;
      }
      return null;
    }
    async function createSubmissionNotification(site, id, item, status, approvedItem = null) {
      const userKey = String(item._submittedByUserKey || item.ownerKey || "");
      if (!userKey) return;
      await ensureModerationTables();
      const title = String(item.text || item.event || item.title || "Untitled submission").slice(0, 300);
      const original = { ...(item.originalSubmission && typeof item.originalSubmission === "object" ? item.originalSubmission : item) };
      delete original._submittedByUserKey;
      delete original.ownerKey;
      delete original.userKey;
      delete original.originalSubmission;
      const payload = JSON.stringify({ original, approved: approvedItem || null });
      await env.DB.prepare("INSERT OR IGNORE INTO submission_notifications (id, user_key, site, item_id, title, status, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(site + ":" + id + ":" + status, userKey, site, String(id), title, status, payload, new Date().toISOString()).run();
    }
    async function recordModerationAction(site, id, item, actor, action) {
      await ensureModerationTables();
      const title = String(item.text || item.event || item.title || item.description || "Untitled submission").slice(0, 500);
      await env.DB.prepare("INSERT OR IGNORE INTO moderation_audit (site, item_id, item_title, submitted_by, moderator, action, acted_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(site, String(id), title, String(item.submittedBy || "Unknown submitter"), String(actor.username || "Unknown admin"), action, new Date().toISOString()).run();
    }
    async function recordApproval(site, id, item, actor) {
      return recordModerationAction(site, id, item, actor, "approved");
    }
    function sanitizeSubmission(value) {
      if (Array.isArray(value)) return value.map(sanitizeSubmission);
      if (!value || typeof value !== "object") return value;
      const clean = {};
      for (const [key, item] of Object.entries(value)) {
        if (/(user.?key|session|token|password|credential)/i.test(key)) continue;
        clean[key] = sanitizeSubmission(item);
      }
      return clean;
    }

    async function listPendingItems(binding) {
      const items = [];
      let cursor;
      do {
        const page = await binding.list({ limit: 1000, ...(cursor ? { cursor } : {}) });
        for (const key of page.keys) {
          if (key.name.startsWith("session:") || key.name.startsWith("ai-session:") || key.name.startsWith("review-schedules:")) continue;
          const value = await binding.get(key.name, "json");
          if (value) items.push(sanitizeSubmission(value));
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      return items;
    }

    if (url.pathname === "/admin/status" && request.method === "GET") {
      const owner = await env.DB.prepare(
        "SELECT user_key FROM users WHERE role IN ('owner', 'admin') UNION SELECT user_key FROM admin_setup WHERE id = 1 LIMIT 1"
      ).first();
      return new Response(JSON.stringify({ initialized: Boolean(owner) }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/admin/bootstrap" && request.method === "POST") {
      const body = await request.json();
      if (!ADMIN_KEY || body.pw !== ADMIN_KEY) {
        return new Response("Unauthorized", { status: 401, headers: cors });
      }
      const userKey = String(body.userKey || "").trim();
      if (!userKey) return new Response("Missing userKey", { status: 400, headers: cors });
      const account = await env.DB.prepare(
        "SELECT user_key FROM users WHERE user_key = ? AND role = 'user'"
      ).bind(userKey).first();
      if (!account) return new Response("Account not found or not eligible for owner setup", { status: 404, headers: cors });
      const usedAt = new Date().toISOString();
      const results = await env.DB.batch([
        env.DB.prepare(
          "INSERT OR IGNORE INTO admin_setup (id, user_key, used_at) SELECT 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM admin_setup WHERE id = 1) AND NOT EXISTS (SELECT 1 FROM users WHERE role IN ('owner', 'admin')) AND EXISTS (SELECT 1 FROM users WHERE user_key = ? AND role = 'user')"
        ).bind(userKey, usedAt, userKey),
        env.DB.prepare(
          "UPDATE users SET role = 'owner' WHERE user_key = ? AND role = 'user' AND EXISTS (SELECT 1 FROM admin_setup WHERE id = 1 AND user_key = ?)"
        ).bind(userKey, userKey)
      ]);
      if (!results?.[0]?.meta?.changes || !results?.[1]?.meta?.changes) {
        return new Response("Owner setup has already been completed", { status: 409, headers: cors });
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/auth" && request.method === "POST") {
      const body = await request.json();
      const userKey = String(body.userKey || "").trim();
      if (!userKey) return new Response("Missing account key", { status: 400, headers: cors });
      const accountSession = await getAccountSession(request);
      if (!accountSession || accountSession.user_key !== userKey) return new Response("Sign in to this account first.", { status: 401, headers: cors });
      const user = await env.DB.prepare(
        "SELECT user_key, username, role FROM users WHERE user_key = ?"
      ).bind(userKey).first();
      if (!user || !["owner", "admin"].includes(user.role)) {
        return new Response("This account does not have admin access", { status: 403, headers: cors });
      }
      const token = crypto.randomUUID() + crypto.randomUUID();
      await env.QUOTEVAULT.put("session:" + token, JSON.stringify({ userKey, accountTokenHash: await hashValue(accountSession.token) }), { expirationTtl: 28800 });
      return new Response(JSON.stringify({ token, username: user.username, role: user.role }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/ai/auth" && request.method === "POST") {
      const accountSession = await getAccountSession(request);
      if (!accountSession) return new Response("Sign in to your account first.", { status: 401, headers: cors });
      const user = await env.DB.prepare(
        "SELECT user_key, username, role, ai_access FROM users WHERE user_key = ?"
      ).bind(accountSession.user_key).first();
      if (!user || (!["owner", "admin"].includes(user.role) && Number(user.ai_access) !== 1)) {
        return new Response("This account does not have AI access.", { status: 403, headers: cors });
      }
      const token = crypto.randomUUID() + crypto.randomUUID();
      await env.QUOTEVAULT.put("ai-session:" + token, JSON.stringify({ userKey: user.user_key, accountTokenHash: await hashValue(accountSession.token) }), { expirationTtl: 28800 });
      return new Response(JSON.stringify({ token, username: user.username, role: user.role }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/ai/session" && request.method === "GET") {
      const user = await getAIUser(request);
      if (!user) return new Response("Unauthorized", { status: 401, headers: cors });
      return new Response(JSON.stringify({ username: user.username, role: user.role }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/ai/logout" && request.method === "POST") {
      const token = request.headers.get("X-AI-Session");
      if (token) await env.QUOTEVAULT.delete("ai-session:" + token);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/auth/session" && request.method === "GET") {
      const user = await getSessionUser(url, request);
      if (!user) return new Response("Unauthorized", { status: 401, headers: cors });
      return new Response(JSON.stringify({ username: user.username, role: user.role }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/auth/logout" && request.method === "POST") {
      const user = await getSessionUser(url, request);
      if (!user) return new Response("Unauthorized", { status: 401, headers: cors });
      await env.QUOTEVAULT.delete("session:" + user.token);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }


    async function hashValue(value) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    }

    async function createAccountSession(userKey) {
      const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
      const token = Array.from(tokenBytes, byte => byte.toString(16).padStart(2, "0")).join("");
      const now = new Date();
      const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await env.DB.prepare(
        "INSERT INTO account_sessions (token_hash, user_key, created_at, expires_at) VALUES (?, ?, ?, ?)"
      ).bind(await hashValue(token), userKey, now.toISOString(), expires.toISOString()).run();
      return token;
    }

    async function getAccountSession(req) {
      const token = req.headers.get("X-Account-Session");
      if (!token || token.length !== 64) return null;
      const row = await env.DB.prepare(
        "SELECT s.user_key, u.username, u.role FROM account_sessions s JOIN users u ON u.user_key = s.user_key WHERE s.token_hash = ? AND s.expires_at > ?"
      ).bind(await hashValue(token), new Date().toISOString()).first();
      return row ? { ...row, token } : null;
    }

    async function verifyPasswordAccountAccess(userKey, req) {
      const credential = await env.DB.prepare(
        "SELECT user_key FROM account_credentials WHERE user_key = ?"
      ).bind(userKey).first();
      if (!credential) return false;
      const session = await getAccountSession(req);
      return Boolean(session && session.user_key === userKey);
    }

    async function verifyAccountAccess(userKey, req) {
      const account = await env.DB.prepare(
        "SELECT user_key FROM users WHERE user_key = ?"
      ).bind(userKey).first();
      if (!account) return true;
      return verifyPasswordAccountAccess(userKey, req);
    }

    if (url.pathname === "/account/setup" && request.method === "POST") {
      const body = await request.json();
      const userKey = String(body.userKey || "").trim();
      const passwordHashValue = String(body.passwordHash || "");
      const passwordSalt = String(body.passwordSalt || "");
      if (!userKey || !/^[a-f0-9]{64}$/i.test(passwordHashValue) || !/^[A-Za-z0-9+\\/]{22}==$/.test(passwordSalt)) {
        return new Response("Invalid password setup details.", { status: 400, headers: cors });
      }
      const account = await env.DB.prepare(
        "SELECT user_key FROM users WHERE user_key = ?"
      ).bind(userKey).first();
      if (!account) return new Response("Account not found.", { status: 404, headers: cors });
      const existing = await env.DB.prepare(
        "SELECT user_key FROM account_credentials WHERE user_key = ?"
      ).bind(userKey).first();
      if (existing) return new Response("This account already has a password. Sign in instead.", { status: 409, headers: cors });
      const now = new Date().toISOString();
      await env.DB.prepare(
        "INSERT INTO account_credentials (user_key, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(userKey, await hashValue(passwordHashValue.toLowerCase()), passwordSalt, now, now).run();
      const token = await createAccountSession(userKey);
      const user = await env.DB.prepare("SELECT username, role FROM users WHERE user_key = ?").bind(userKey).first();
      return new Response(JSON.stringify({ token, userKey, username: user.username, role: user.role || "user" }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/account/challenge" && request.method === "GET") {
      const username = String(url.searchParams.get("username") || "").trim();
      if (!username || username.length > 20) return new Response("Invalid username or password.", { status: 400, headers: cors });
      const credential = await env.DB.prepare(
        "SELECT c.password_salt FROM users u JOIN account_credentials c ON c.user_key = u.user_key WHERE LOWER(u.username) = LOWER(?)"
      ).bind(username).first();
      if (!credential) return new Response("Invalid username or password.", { status: 404, headers: cors });
      return new Response(JSON.stringify({ passwordSalt: credential.password_salt }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }
    if (url.pathname === "/account/login" && request.method === "POST") {
      const body = await request.json();
      const username = String(body.username || "").trim();
      const passwordHashValue = String(body.passwordHash || "");
      if (!username || !/^[a-f0-9]{64}$/i.test(passwordHashValue) || username.length > 20) {
        return new Response("Invalid username or password.", { status: 400, headers: cors });
      }
      const rateKey = "account-login:" + await hashValue((request.headers.get("CF-Connecting-IP") || "unknown") + ":" + username.toLowerCase());
      const attempts = Number(await env.QUOTEVAULT.get(rateKey) || 0);
      if (attempts >= 8) return new Response("Too many sign-in attempts. Try again in 15 minutes.", { status: 429, headers: cors });
      await env.QUOTEVAULT.put(rateKey, String(attempts + 1), { expirationTtl: 900 });
      const user = await env.DB.prepare(
        "SELECT u.user_key, u.username, u.role, c.password_hash, c.password_salt FROM users u JOIN account_credentials c ON c.user_key = u.user_key WHERE LOWER(u.username) = LOWER(?)"
      ).bind(username).first();
      if (!user) return new Response("Invalid username or password.", { status: 401, headers: cors });
      if (await hashValue(passwordHashValue.toLowerCase()) !== user.password_hash.toLowerCase()) return new Response("Invalid username or password.", { status: 401, headers: cors });
      await env.QUOTEVAULT.delete(rateKey);
      const token = await createAccountSession(user.user_key);
      return new Response(JSON.stringify({ token, userKey: user.user_key, username: user.username, role: user.role || "user" }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }


    if (url.pathname === "/account/reset" && request.method === "POST") {
      const body = await request.json();
      const userKey = String(body.userKey || "").trim();
      const passwordHashValue = String(body.passwordHash || "");
      const passwordSalt = String(body.passwordSalt || "");
      if (!userKey || !/^[a-f0-9]{64}$/i.test(passwordHashValue) || !/^[A-Za-z0-9+\\/]{22}==$/.test(passwordSalt)) {
        return new Response("Invalid password reset details.", { status: 400, headers: cors });
      }
      const account = await env.DB.prepare("SELECT user_key FROM users WHERE user_key = ?").bind(userKey).first();
      if (!account) return new Response("Account not found.", { status: 404, headers: cors });
      const existing = await env.DB.prepare("SELECT user_key FROM account_credentials WHERE user_key = ?").bind(userKey).first();
      if (!existing) return new Response("Set up a password before using password reset.", { status: 404, headers: cors });
      await env.DB.prepare("UPDATE account_credentials SET password_hash = ?, password_salt = ?, updated_at = ? WHERE user_key = ?")
        .bind(await hashValue(passwordHashValue.toLowerCase()), passwordSalt, new Date().toISOString(), userKey).run();
      await env.DB.prepare("DELETE FROM account_sessions WHERE user_key = ?").bind(userKey).run();
      const token = await createAccountSession(userKey);
      const user = await env.DB.prepare("SELECT username, role FROM users WHERE user_key = ?").bind(userKey).first();
      return new Response(JSON.stringify({ token, userKey, username: user.username, role: user.role || "user" }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/account/session" && request.method === "GET") {
      const session = await getAccountSession(request);
      if (!session) return new Response("Unauthorized", { status: 401, headers: cors });
      return new Response(JSON.stringify({ userKey: session.user_key, username: session.username, role: session.role || "user" }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/account/logout" && request.method === "POST") {
      const session = await getAccountSession(request);
      if (!session) return new Response("Unauthorized", { status: 401, headers: cors });
      await env.DB.prepare("DELETE FROM account_sessions WHERE token_hash = ?").bind(await hashValue(session.token)).run();
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    const accountScopedPaths = new Set([
      "/lb/update-theme", "/lb/streak",
      "/themes/save", "/themes/list", "/themes/delete",
      "/revision/public/delete", "/dv/withdraw", "/withdraw"
    ]);
    if (accountScopedPaths.has(url.pathname)) {
      let userKey = url.searchParams.get("userKey");
      if (request.method !== "GET") {
        try {
          const body = await request.clone().json();
          userKey = userKey || String(body.userKey || "").trim();
        } catch {}
      }
      if (userKey && !(await verifyAccountAccess(userKey, request))) {
        return new Response("Sign in to this account first.", { status: 401, headers: cors });
      }
    }

    if (url.pathname === "/admin/published" && request.method === "GET") {
      if (!await isAuthorized(url, request)) return new Response("Unauthorized", { status: 401, headers: cors });
      const quotes = await listPendingItems(env.PUBLIC_QUOTES);
      const dates = await listPendingItems(env.DV_PUBLIC);
      await ensureModerationTables();
      const [quoteAudit, dateAudit] = await Promise.all([
        env.DB.prepare("SELECT item_id, submitted_by FROM moderation_audit WHERE site = 'quote' AND action = 'approved'").all(),
        env.DB.prepare("SELECT item_id, submitted_by FROM moderation_audit WHERE site = 'date' AND action = 'approved'").all()
      ]);
      const quoteOwners = new Map((quoteAudit.results || []).map(item => [String(item.item_id), item.submitted_by]));
      const dateOwners = new Map((dateAudit.results || []).map(item => [String(item.item_id), item.submitted_by]));
      for (const item of quotes) item.submittedBy = quoteOwners.get(String(item.id)) || "Legacy submission";
      for (const item of dates) item.submittedBy = dateOwners.get(String(item.id)) || "Legacy submission";
      return new Response(JSON.stringify({ quotes, dates }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (url.pathname === "/admin/users" && request.method === "GET") {
      const actor = await getSessionUser(url, request);
      if (!actor) return new Response("Unauthorized", { status: 401, headers: cors });
      if (actor.role !== "owner") return new Response("Owner access required", { status: 403, headers: cors });
      await ensureLeaderboardVisibilityColumn();
      const { results } = await env.DB.prepare(
        "SELECT username, role, ai_access, leaderboard_hidden FROM users ORDER BY username COLLATE NOCASE"
      ).all();
      return new Response(JSON.stringify({ users: results }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/admin/leaderboard-visibility" && request.method === "POST") {
      const actor = await getSessionUser(url, request);
      if (!actor) return new Response("Unauthorized", { status: 401, headers: cors });
      if (actor.role !== "owner") return new Response("Owner access required", { status: 403, headers: cors });
      const body = await request.json();
      const username = String(body.username || "").trim();
      if (!username || typeof body.hidden !== "boolean") return new Response("Invalid leaderboard visibility request", { status: 400, headers: cors });
      await ensureLeaderboardVisibilityColumn();
      const result = await env.DB.prepare("UPDATE users SET leaderboard_hidden = ? WHERE LOWER(username) = LOWER(?)").bind(body.hidden ? 1 : 0, username).run();
      if (!result.meta?.changes) return new Response("Account not found", { status: 404, headers: cors });
      return new Response(JSON.stringify({ success: true, username, hidden: body.hidden }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/admin/moderation-log" && request.method === "GET") {
      const actor = await getSessionUser(url, request);
      if (!actor) return new Response("Unauthorized", { status: 401, headers: cors });
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS moderation_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, item_id TEXT NOT NULL, item_title TEXT NOT NULL, submitted_by TEXT NOT NULL, moderator TEXT NOT NULL, action TEXT NOT NULL, acted_at TEXT NOT NULL, UNIQUE(site, item_id, action))").bind().run();
      const { results } = await env.DB.prepare("SELECT site, item_id, item_title, submitted_by, moderator, action, acted_at FROM moderation_audit ORDER BY acted_at DESC LIMIT 500").all();
      return new Response(JSON.stringify({ entries: results }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (url.pathname === "/submissions/notifications" && request.method === "GET") {
      const account = await getAccountSession(request);
      if (!account) return new Response("Sign in to view submission updates.", { status: 401, headers: cors });
      await ensureModerationTables();
      const { results } = await env.DB.prepare("SELECT id, site, item_id, title, status, payload, created_at FROM submission_notifications WHERE user_key = ? AND acknowledged_at IS NULL ORDER BY created_at ASC LIMIT 20").bind(account.user_key).all();
      return new Response(JSON.stringify({ notifications: results.map(item => ({ ...item, payload: JSON.parse(item.payload || "{}") })) }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (url.pathname === "/submissions/private/remove" && request.method === "POST") {
      const account = await getAccountSession(request);
      if (!account) return new Response("Sign in to manage saved submissions.", { status: 401, headers: cors });
      const body = await request.json();
      const site = String(body.site || "");
      const id = String(body.id || "");
      if (!["qv", "dv"].includes(site) || !id) return new Response("Invalid submission.", { status: 400, headers: cors });
      const dataColumn = site + "_pending_data";
      const idsColumn = site + "_pending_ids";
      const rejectedColumn = site + "_rejected_ids";
      const row = await env.DB.prepare("SELECT " + dataColumn + ", " + idsColumn + ", " + rejectedColumn + " FROM users WHERE user_key = ?").bind(account.user_key).first();
      if (!row) return new Response("Account not found.", { status: 404, headers: cors });
      let pendingData = [], pendingIds = [], rejectedIds = [];
      try { pendingData = JSON.parse(row[dataColumn] || "[]"); } catch {}
      try { pendingIds = JSON.parse(row[idsColumn] || "[]"); } catch {}
      try { rejectedIds = JSON.parse(row[rejectedColumn] || "[]"); } catch {}
      pendingData = pendingData.filter(item => String(item.id) !== id);
      pendingIds = pendingIds.filter(value => String(value) !== id);
      rejectedIds = rejectedIds.filter(value => String(value) !== id);
      await env.DB.prepare("UPDATE users SET " + dataColumn + " = ?, " + idsColumn + " = ?, " + rejectedColumn + " = ?, updated_at = ? WHERE user_key = ?").bind(JSON.stringify(pendingData), JSON.stringify(pendingIds), JSON.stringify(rejectedIds), new Date().toISOString(), account.user_key).run();
      return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (url.pathname === "/submissions/notifications/resolve" && request.method === "POST") {
      const account = await getAccountSession(request);
      if (!account) return new Response("Sign in to update submission notifications.", { status: 401, headers: cors });
      const body = await request.json();
      const id = String(body.id || "");
      const choice = String(body.choice || "");
      if (!id || !["keep", "replace", "remove"].includes(choice)) return new Response("Invalid notification choice.", { status: 400, headers: cors });
      const notification = await env.DB.prepare("SELECT site, item_id, status, payload FROM submission_notifications WHERE id = ? AND user_key = ? AND acknowledged_at IS NULL").bind(id, account.user_key).first();
      if (!notification) return new Response("Notification not found or already handled.", { status: 404, headers: cors });
      if (["qv", "dv"].includes(notification.site)) {
        const pendingDataColumn = notification.site + "_pending_data";
        const row = await env.DB.prepare("SELECT " + pendingDataColumn + " FROM users WHERE user_key = ?").bind(account.user_key).first();
        let pendingData = [];
        try { pendingData = JSON.parse(row?.[pendingDataColumn] || "[]"); } catch {}
        if (notification.status === "denied" && choice === "remove") {
          pendingData = pendingData.filter(item => String(item.id) !== notification.item_id);
        } else if (notification.status === "approved") {
          const payload = JSON.parse(notification.payload || "{}");
          const chosen = choice === "replace" && payload.approved ? payload.approved : payload.original;
          pendingData = pendingData.filter(item => String(item.id) !== notification.item_id);
          if (chosen) pendingData.push({ ...chosen, id: notification.item_id, _status: "approved-private" });
        } else if (notification.status === "denied") {
          const payload = JSON.parse(notification.payload || "{}");
          pendingData = pendingData.map(item => String(item.id) === notification.item_id ? { ...item, _status: "denied" } : item);
          if (!pendingData.some(item => String(item.id) === notification.item_id) && payload.original) pendingData.push({ ...payload.original, id: notification.item_id, _status: "denied" });
        }
        await env.DB.prepare("UPDATE users SET " + pendingDataColumn + " = ?, updated_at = ? WHERE user_key = ?").bind(JSON.stringify(pendingData), new Date().toISOString(), account.user_key).run();
      }
      await env.DB.prepare("UPDATE submission_notifications SET acknowledged_at = ?, choice = ? WHERE id = ? AND user_key = ? AND acknowledged_at IS NULL").bind(new Date().toISOString(), choice, id, account.user_key).run();
      return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/admin/ai-access" && request.method === "POST") {
      const actor = await getSessionUser(url, request);
      if (!actor) return new Response("Unauthorized", { status: 401, headers: cors });
      if (actor.role !== "owner") return new Response("Owner access required", { status: 403, headers: cors });
      const body = await request.json();
      const username = String(body.username || "").trim();
      if (!username || typeof body.enabled !== "boolean") return new Response("Invalid AI access request", { status: 400, headers: cors });
      const target = await env.DB.prepare(
        "SELECT user_key, role FROM users WHERE LOWER(username) = LOWER(?)"
      ).bind(username).first();
      if (!target) return new Response("Account not found", { status: 404, headers: cors });
      if (target.role !== "user") return new Response("AI access is inherited by owners and admins.", { status: 400, headers: cors });
      await env.DB.prepare(
        "UPDATE users SET ai_access = ? WHERE user_key = ? AND role = 'user'"
      ).bind(body.enabled ? 1 : 0, target.user_key).run();
      return new Response(JSON.stringify({ success: true, username, ai_access: body.enabled }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/admin/migrate-storage" && request.method === "POST") {
      const actor = await getSessionUser(url, request);
      if (!actor) return new Response("Unauthorized", { status: 401, headers: cors });
      if (actor.role !== "owner") return new Response("Owner access required", { status: 403, headers: cors });
      const body = await request.json();
      const phase = body.phase;
      if (!["revision", "revision-leaderboard", "themes"].includes(phase)) return new Response("Invalid migration phase", { status: 400, headers: cors });
      const limit = Math.max(1, Math.min(100, Math.floor(Number(body.limit) || 100)));
      const binding = phase === "themes" ? env.THEMES : env.REVISION;
      const prefix = phase === "revision" ? "user:" : phase === "revision-leaderboard" ? "leaderboard:" : "theme:";
      const page = await binding.list({ prefix, limit, ...(body.cursor ? { cursor: body.cursor } : {}) });
      let migrated = 0;
      let alreadyPresent = 0;
      let skipped = 0;
      for (const item of page.keys) {
        const value = await binding.get(item.name, "json");
        if (!value) {
          skipped++;
          continue;
        }
        if (phase === "revision") {
          const userKey = item.name.slice("user:".length);
          const result = await env.DB.prepare(
            "INSERT OR IGNORE INTO revision_sync_data (user_key, data_json, updated_at) VALUES (?, ?, ?)"
          ).bind(userKey, JSON.stringify(value), String(value.updatedAt || new Date().toISOString())).run();
          if (result.meta?.changes) migrated++;
          else alreadyPresent++;
        } else if (phase === "themes") {
          const remainder = item.name.slice("theme:".length);
          const separator = remainder.lastIndexOf(":");
          if (separator < 1) {
            skipped++;
            continue;
          }
          const userKey = remainder.slice(0, separator);
          const themeKey = remainder.slice(separator + 1);
          if (!/^[a-zA-Z0-9_]{1,80}$/.test(themeKey)) {
            skipped++;
            continue;
          }
          const result = await env.DB.prepare(
            "INSERT OR IGNORE INTO custom_themes (user_key, theme_key, theme_json, updated_at) VALUES (?, ?, ?, ?)"
          ).bind(userKey, themeKey, JSON.stringify(value), new Date().toISOString()).run();
          if (result.meta?.changes) migrated++;
          else alreadyPresent++;
        } else {
          const userKey = String(value.userKey || item.name.slice("leaderboard:".length)).trim();
          const username = String(value.username || "").trim().slice(0, 20);
          const xp = Number(value.xp);
          const streak = Number(value.streak);
          if (!userKey || !username || !Number.isFinite(xp) || xp < 0 || !Number.isFinite(streak) || streak < 0) {
            skipped++;
            continue;
          }
          const result = await env.DB.prepare(
            "INSERT OR IGNORE INTO revision_leaderboard (user_key, username, xp, streak, updated_at) VALUES (?, ?, ?, ?, ?)"
          ).bind(userKey, username, Math.floor(xp), Math.floor(streak), String(value.updatedAt || new Date().toISOString())).run();
          if (result.meta?.changes) migrated++;
          else alreadyPresent++;
        }
      }
      return new Response(JSON.stringify({
        phase,
        processed: page.keys.length,
        migrated,
        alreadyPresent,
        skipped,
        complete: page.list_complete,
        cursor: page.list_complete ? null : page.cursor
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/admin/users" && request.method === "POST") {
      const actor = await getSessionUser(url, request);
      if (!actor) return new Response("Unauthorized", { status: 401, headers: cors });
      if (actor.role !== "owner") return new Response("Owner access required", { status: 403, headers: cors });
      const body = await request.json();
      const username = String(body.username || "").trim();
      const role = body.role;
      if (!username || !["admin", "user"].includes(role)) {
        return new Response("Invalid username or role", { status: 400, headers: cors });
      }
      const target = await env.DB.prepare(
        "SELECT user_key, role FROM users WHERE LOWER(username) = LOWER(?)"
      ).bind(username).first();
      if (!target) return new Response("Account not found", { status: 404, headers: cors });
      if (target.role === "owner") return new Response("The owner role cannot be changed here", { status: 403, headers: cors });
      await env.DB.prepare(
        "UPDATE users SET role = ? WHERE user_key = ? AND role != 'owner'"
      ).bind(role, target.user_key).run();
      return new Response(JSON.stringify({ success: true, username, role }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ── QUOTEVAULT QUOTES (public) ────────────────────────────────────────────
    if (url.pathname === "/quotes" && request.method === "GET") {
      const list = await env.PUBLIC_QUOTES.list();
      const items = [];
      for (const key of list.keys) {
        const value = await env.PUBLIC_QUOTES.get(key.name, "json");
        if (value) items.push(value);
      }
      return new Response(JSON.stringify({ items }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ── QUOTEVAULT PENDING ────────────────────────────────────────────────────
    if (url.pathname === "/pending" && request.method === "GET") {
      if (!await isAuthorized(url, request)) {
        return new Response("Unauthorized", { status: 401, headers: cors });
      }
      const items = await listPendingItems(env.QUOTEVAULT);
      const owners = await getSubmissionOwners("qv");
      for (const item of items) {
        item.submittedBy = item.submittedBy || owners.get(String(item.id)) || "Legacy submission";
      }
      return new Response(JSON.stringify({ items }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ── QUOTEVAULT WITHDRAW (user removes their own pending submission) ──────────
    if (url.pathname === "/withdraw" && request.method === "POST") {
      const body = await request.json();
      const { userKey, id } = body;
      if (!userKey || !id) return new Response("Missing userKey or id", { status: 400, headers: cors });

      {

        try {
          const row = await env.DB.prepare(
            `SELECT qv_pending_ids, qv_pending_data FROM users WHERE user_key = ?`
          ).bind(userKey).first();

          if (!row) return new Response("Forbidden", { status: 403, headers: cors });

          const pendingIds = JSON.parse(row.qv_pending_ids || "[]");
          if (!pendingIds.map(String).includes(String(id))) {
            return new Response("Forbidden", { status: 403, headers: cors });
          }
          const newPendingIds = pendingIds.filter(i => String(i) !== String(id));
          const pendingData = JSON.parse(row.qv_pending_data || "[]");
          const newPendingData = pendingData.filter(p => String(p.id) !== String(id));
          await env.DB.prepare(
            `UPDATE users SET qv_pending_ids=?, qv_pending_data=?, updated_at=? WHERE user_key=?`
          ).bind(
            JSON.stringify(newPendingIds),
            JSON.stringify(newPendingData),
            new Date().toISOString(),
            userKey
          ).run();
        } catch (e) {
          return new Response(JSON.stringify({ success: false, error: "Could not verify submission ownership." }), {
            status: 500,
            headers: { ...cors, "Content-Type": "application/json" }
          });
        }
      }

      await env.QUOTEVAULT.delete(id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ── QUOTEVAULT SUBMIT ─────────────────────────────────────────────────────
    if (url.pathname === "/submit" && request.method === "POST") {
      const data = await request.json();
      const userKey = String(data.userKey || "").trim();
      if (!userKey || !(await verifyPasswordAccountAccess(userKey, request))) {
        return new Response("A signed-in password account is required to submit quotes.", { status: 401, headers: cors });
      }
      const submitter = await getAccountSession(request);
      delete data.userKey;
      data.submittedBy = submitter?.username || "Account holder";
      data._submittedByUserKey = userKey;
      const id = Date.now().toString() + "-" + Math.random().toString(36).slice(2, 8);
      data.id = id;
      data.submittedAt = new Date().toISOString();
      await env.QUOTEVAULT.put(id, JSON.stringify(data));
      return new Response(JSON.stringify({ success: true, id }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ── QUOTEVAULT APPROVE ────────────────────────────────────────────────────
    if (url.pathname === "/approve" && request.method === "POST") {
      const body = await request.json();
      const id = String(body.id || "").trim();
      if (!id) return new Response("Missing id", { status: 400, headers: cors });
      const actor = await getSessionUser(url, request);
      if (!actor) return new Response("Unauthorized", { status: 401, headers: cors });
      const quote = await env.QUOTEVAULT.get(id, "json");
      if (!quote) return new Response("Quote not found", { status: 404, headers: cors });
      await attachSubmissionOwner("qv", id, quote);
      const publishedQuote = { ...quote };
      delete publishedQuote.submittedBy;
      delete publishedQuote._submittedByUserKey;
      delete publishedQuote.originalSubmission;
      delete publishedQuote.userKey;
      await env.PUBLIC_QUOTES.put(id, JSON.stringify(publishedQuote));
      try {
        await createSubmissionNotification("qv", id, quote, "approved", publishedQuote);
        await recordApproval("quote", id, quote, actor);
        await updateModerationRecords("qv", id, false);
      } catch {
        return new Response("Quote was published, but account records could not be updated. The submission remains pending so you can retry.", {
          status: 500,
          headers: cors
        });
      }
      await env.QUOTEVAULT.delete(id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ── QUOTEVAULT REJECT ─────────────────────────────────────────────────────
    if (url.pathname === "/reject" && request.method === "POST") {
      const body = await request.json();
      const id = String(body.id || "").trim();
      if (!id) return new Response("Missing id", { status: 400, headers: cors });
      const actor = await getSessionUser(url, request);
      if (!actor) return new Response("Unauthorized", { status: 401, headers: cors });
      const quote = await env.QUOTEVAULT.get(id, "json");
      if (!quote) return new Response("Quote not found", { status: 404, headers: cors });
      await attachSubmissionOwner("qv", id, quote);
      try {
        await createSubmissionNotification("qv", id, quote, "denied");
        await recordModerationAction("quote", id, quote, actor, "denied");
        await updateModerationRecords("qv", id, true);
      } catch {
        return new Response("Account records could not be updated. The submission remains pending so you can retry.", {
          status: 500,
          headers: cors
        });
      }
      await env.QUOTEVAULT.delete(id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ── QUOTEVAULT UPDATE PENDING ─────────────────────────────────────────────
    if (url.pathname === "/update-pending" && request.method === "POST") {
      const body = await request.json();
      if (!await isAuthorized(url, request)) return new Response("Unauthorized", { status: 401, headers: cors });
      const id = String(body.id || "").trim();
      const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : null;
      if (!id || !data) return new Response("Missing id or data", { status: 400, headers: cors });
      const existing = await env.QUOTEVAULT.get(id, "json");
      if (!existing) return new Response("Pending quote not found", { status: 404, headers: cors });
      const updated = { ...existing, ...data, id, submittedAt: existing.submittedAt, submittedBy: existing.submittedBy, _submittedByUserKey: existing._submittedByUserKey, originalSubmission: existing.originalSubmission || Object.fromEntries(Object.entries(existing).filter(([key]) => !["_submittedByUserKey", "originalSubmission"].includes(key))) };
      delete updated.userKey;
      await env.QUOTEVAULT.put(id, JSON.stringify(updated));
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ── QUOTEVAULT UPDATE PUBLIC ──────────────────────────────────────────────
    if (url.pathname === "/update-public" && request.method === "POST") {
      const body = await request.json();
      const ok = await isAuthorized(url, request);
      if (!ok) return new Response("Unauthorized", { status: 401, headers: cors });
      const existing = await env.PUBLIC_QUOTES.get(body.id, "json");
      if (!existing) return new Response("Not found", { status: 404, headers: cors });
      const updated = { ...existing, ...body.data, id: body.id, submittedAt: existing.submittedAt };
      await env.PUBLIC_QUOTES.put(body.id, JSON.stringify(updated));
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ── QUOTEVAULT DELETE PUBLIC ──────────────────────────────────────────────
    if (url.pathname === "/delete" && request.method === "POST") {
      const body = await request.json();
      const ok = await isAuthorized(url, request);
      if (!ok) return new Response("Unauthorized", { status: 401, headers: cors });
      const existing = await env.PUBLIC_QUOTES.get(body.id, "json");
      if (existing) await recordModerationAction("quote", body.id, existing, await getSessionUser(url, request), "removed");
      await env.PUBLIC_QUOTES.delete(body.id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ── DATEVAULT ROUTES ──────────────────────────────────────────────────────

        if (url.pathname === "/dv/submit" && request.method === "POST") {
      const data = await request.json();
      const userKey = String(data.userKey || "").trim();
      if (!userKey || !(await verifyPasswordAccountAccess(userKey, request))) {
        return new Response("A signed-in password account is required to submit dates.", { status: 401, headers: cors });
      }
      const submitter = await getAccountSession(request);
      delete data.userKey;
      data.submittedBy = submitter?.username || "Account holder";
      data._submittedByUserKey = userKey;
      const id = Date.now().toString() + "-" + Math.random().toString(36).slice(2, 8);
      data.id = id;
      data.submittedAt = new Date().toISOString();
      await env.DV_PENDING.put(id, JSON.stringify(data));
      return new Response(JSON.stringify({ success: true, id }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/dv/withdraw" && request.method === "POST") {
      const body = await request.json();
      const { userKey, id } = body;

      if (!userKey || !id) {
        return new Response("Missing fields", { status: 400, headers: cors });
      }

      try {
        const row = await env.DB.prepare(
          `SELECT dv_pending_ids, dv_pending_data FROM users WHERE user_key = ?`
        ).bind(userKey).first();

        if (!row) return new Response("Forbidden", { status: 403, headers: cors });
        const storedPendingIds = JSON.parse(row.dv_pending_ids || "[]");
        if (!storedPendingIds.map(String).includes(String(id))) {
          return new Response("Forbidden", { status: 403, headers: cors });
        }
        const pendingIds = storedPendingIds.filter(x => String(x) !== String(id));
        const pendingData = JSON.parse(row.dv_pending_data || "[]")
          .filter(x => String(x.id) !== String(id));

        await env.DB.prepare(`
          UPDATE users
          SET dv_pending_ids=?, dv_pending_data=?, updated_at=?
          WHERE user_key=?
        `).bind(
          JSON.stringify(pendingIds),
          JSON.stringify(pendingData),
          new Date().toISOString(),
          userKey
        ).run();
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }

      await env.DV_PENDING.delete(id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/dv/quotes" && request.method === "GET") {
      const list = await env.DV_PUBLIC.list();
      const items = [];
      for (const key of list.keys) {
        const value = await env.DV_PUBLIC.get(key.name, "json");
        if (value) items.push(value);
      }
      return new Response(JSON.stringify({ items }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/dv/pending" && request.method === "GET") {
      if (!await isAuthorized(url, request)) {
        return new Response("Unauthorized", { status: 401, headers: cors });
      }
      const items = await listPendingItems(env.DV_PENDING);
      const owners = await getSubmissionOwners("dv");
      for (const item of items) {
        item.submittedBy = item.submittedBy || owners.get(String(item.id)) || "Legacy submission";
      }
      return new Response(JSON.stringify({ items }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/dv/approve" && request.method === "POST") {
      const body = await request.json();
      const id = String(body.id || "").trim();
      if (!id) return new Response("Missing id", { status: 400, headers: cors });
      const actor = await getSessionUser(url, request);
      if (!actor) return new Response("Unauthorized", { status: 401, headers: cors });
      const fact = await env.DV_PENDING.get(id, "json");
      if (!fact) return new Response("Fact not found", { status: 404, headers: cors });
      await attachSubmissionOwner("dv", id, fact);
      const publishedFact = { ...fact };
      delete publishedFact.submittedBy;
      delete publishedFact._submittedByUserKey;
      delete publishedFact.originalSubmission;
      delete publishedFact.userKey;
      await env.DV_PUBLIC.put(id, JSON.stringify(publishedFact));
      try {
        await createSubmissionNotification("dv", id, fact, "approved", publishedFact);
        await recordApproval("date", id, fact, actor);
        await updateModerationRecords("dv", id, false);
      } catch {
        return new Response("Fact was published, but account records could not be updated. The submission remains pending so you can retry.", {
          status: 500,
          headers: cors
        });
      }
      await env.DV_PENDING.delete(id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/dv/reject" && request.method === "POST") {
      const body = await request.json();
      const id = String(body.id || "").trim();
      if (!id) return new Response("Missing id", { status: 400, headers: cors });
      const actor = await getSessionUser(url, request);
      if (!actor) return new Response("Unauthorized", { status: 401, headers: cors });
      const fact = await env.DV_PENDING.get(id, "json");
      if (!fact) return new Response("Fact not found", { status: 404, headers: cors });
      await attachSubmissionOwner("dv", id, fact);
      try {
        await createSubmissionNotification("dv", id, fact, "denied");
        await recordModerationAction("date", id, fact, actor, "denied");
        await updateModerationRecords("dv", id, true);
      } catch {
        return new Response("Account records could not be updated. The submission remains pending so you can retry.", {
          status: 500,
          headers: cors
        });
      }
      await env.DV_PENDING.delete(id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/dv/update-pending" && request.method === "POST") {
      const body = await request.json();
      const ok = await isAuthorized(url, request);
      if (!ok) return new Response("Unauthorized", { status: 401, headers: cors });
      const existing = await env.DV_PENDING.get(body.id, "json");
      if (!existing) return new Response("Not found", { status: 404, headers: cors });
      const updated = { ...existing, ...body.data, id: body.id, submittedAt: existing.submittedAt, submittedBy: existing.submittedBy, _submittedByUserKey: existing._submittedByUserKey, originalSubmission: existing.originalSubmission || Object.fromEntries(Object.entries(existing).filter(([key]) => !["_submittedByUserKey", "originalSubmission"].includes(key))) };
      await env.DV_PENDING.put(body.id, JSON.stringify(updated));
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/dv/update-public" && request.method === "POST") {
      const body = await request.json();
      const ok = await isAuthorized(url, request);
      if (!ok) return new Response("Unauthorized", { status: 401, headers: cors });
      const existing = await env.DV_PUBLIC.get(body.id, "json");
      if (!existing) return new Response("Not found", { status: 404, headers: cors });
      const updated = { ...existing, ...body.data, id: body.id, submittedAt: existing.submittedAt };
      await env.DV_PUBLIC.put(body.id, JSON.stringify(updated));
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/dv/delete" && request.method === "POST") {
      const body = await request.json();
      const ok = await isAuthorized(url, request);
      if (!ok) return new Response("Unauthorized", { status: 401, headers: cors });
      const existing = await env.DV_PUBLIC.get(body.id, "json");
      if (existing) await recordModerationAction("date", body.id, existing, await getSessionUser(url, request), "removed");
      await env.DV_PUBLIC.delete(body.id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // LEADERBOARD ROUTES — powered by D1 (SQLite)
    // ════════════════════════════════════════════════════════════════════════

    // GET /lb/list
    if (url.pathname === "/lb/list" && request.method === "GET") {
      await ensureLeaderboardVisibilityColumn();
      const { results } = await env.DB.prepare(`
        SELECT username, qv_mastered, dv_mastered, qv_xp, dv_xp,
               streak, max_streak, updated_at
        FROM users
        WHERE COALESCE(leaderboard_hidden, 0) = 0
        ORDER BY (qv_xp + dv_xp) DESC
      `).all();

      const users = results.map(r => ({
        username:    r.username,
        qv_mastered: r.qv_mastered,
        dv_mastered: r.dv_mastered,
        qv_xp:       r.qv_xp,
        dv_xp:       r.dv_xp,
        streak:      r.streak     || 0,
        max_streak:  r.max_streak || 0,
        updatedAt:   r.updated_at,
      }));

      return new Response(JSON.stringify({ users }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/lb/username-available" && request.method === "GET") {
      const username = url.searchParams.get("username");
      const userKey = url.searchParams.get("userKey");
      if (!username) return new Response("Missing username", { status: 400, headers: cors });
      const existing = await env.DB.prepare(
        `SELECT user_key FROM users WHERE LOWER(username) = LOWER(?)`
      ).bind(username.trim()).first();
      const available = !existing || Boolean(userKey && existing.user_key === userKey);
      return new Response(JSON.stringify({ available }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // GET /lb/get?userKey=X  or  /lb/get?username=X
    if (url.pathname === "/lb/get" && request.method === "GET") {
      const userKey  = url.searchParams.get("userKey");
      const username = url.searchParams.get("username");

      let row;
      if (userKey) {
        row = await env.DB.prepare(`SELECT * FROM users WHERE user_key = ?`).bind(userKey).first();
      } else if (username) {
        row = await env.DB.prepare(`SELECT * FROM users WHERE LOWER(username) = LOWER(?)`).bind(username.trim()).first();
      } else {
        return new Response("Missing userKey or username", { status: 400, headers: cors });
      }

      if (!row) {
        return new Response(JSON.stringify({ found: false }), {
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }

      if (!userKey) {
        return new Response(JSON.stringify({ found: true, user: { username: row.username } }), {
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }

      const credential = await env.DB.prepare("SELECT user_key FROM account_credentials WHERE user_key = ?").bind(userKey).first();
      if (!credential) {
        return new Response(JSON.stringify({ found: true, user: { username: row.username } }), {
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }
      if (!(await verifyAccountAccess(userKey, request))) {
        return new Response("Sign in to sync this account.", { status: 401, headers: cors });
      }

      const user = {
        userKey:          row.user_key,
        username:         row.username,
        qv_mastered:      row.qv_mastered,
        dv_mastered:      row.dv_mastered,
        qv_xp:            row.qv_xp,
        dv_xp:            row.dv_xp,
        streak:           row.streak     || 0,
        max_streak:       row.max_streak || 0,
        qv_mastered_ids:  JSON.parse(row.qv_mastered_ids  || "[]"),
        dv_mastered_ids:  JSON.parse(row.dv_mastered_ids  || "[]"),
        qv_pending_ids:   JSON.parse(row.qv_pending_ids   || "[]"),
        dv_pending_ids:   JSON.parse(row.dv_pending_ids   || "[]"),
        qv_rejected_ids:  JSON.parse(row.qv_rejected_ids  || "[]"),
        dv_rejected_ids:  JSON.parse(row.dv_rejected_ids  || "[]"),
        qv_pending_data:  JSON.parse(row.qv_pending_data  || "[]"),
        dv_pending_data:  JSON.parse(row.dv_pending_data  || "[]"),
        theme:            row.theme || "",
        updatedAt:        row.updated_at,
      };

      return new Response(JSON.stringify({ found: true, user }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // POST /lb/register — upsert a user's stats
    if (url.pathname === "/lb/register" && request.method === "POST") {
      const body = await request.json();
      let { userKey, username, site, mastered, xp, mastered_ids,
            pending_ids, pending_data, theme } = body;
      if (userKey) {
        const existingAccount = await env.DB.prepare("SELECT user_key FROM users WHERE user_key = ?").bind(userKey).first();
        if (existingAccount && !(await verifyAccountAccess(userKey, request))) {
          return new Response("Sign in with a password account before joining or updating leaderboards.", { status: 401, headers: cors });
        }
      }

      if (!username || !site || mastered === undefined || xp === undefined) {
        return new Response("Missing fields", { status: 400, headers: cors });
      }
      if (!["qv", "dv"].includes(site)) {
        return new Response("Invalid site", { status: 400, headers: cors });
      }
      mastered = Number(mastered);
      xp = Number(xp);
      if (!Number.isFinite(mastered) || !Number.isFinite(xp) || mastered < 0 || xp < 0) {
        return new Response("Invalid statistics", { status: 400, headers: cors });
      }

      const clean = username.trim();
      if (clean.length < 3 || clean.length > 20 || !/^[a-zA-Z0-9_-]+$/.test(clean)) {
        return new Response(
          JSON.stringify({ error: "Username must be 3–20 characters, letters, numbers, _ or - only." }),
          { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
        );
      }

      const incomingIds = Array.isArray(mastered_ids)
        ? mastered_ids.map(String).slice(0, 2000)
        : [];

      const incomingPendingIds = Array.isArray(pending_ids)
        ? pending_ids.map(String).slice(0, 500)
        : null;

      const incomingPendingData = Array.isArray(pending_data)
        ? pending_data.slice(0, 500)
        : null;

      const MAX_XP_JUMP       = 1500;
      const MAX_MASTERED_JUMP = 1;

      if (userKey) {
        const existing = await env.DB.prepare(
          `SELECT * FROM users WHERE user_key = ?`
        ).bind(userKey).first();

        if (!existing || existing.username.toLowerCase() !== clean.toLowerCase()) {
          const conflict = await env.DB.prepare(
            `SELECT user_key FROM users WHERE LOWER(username) = LOWER(?) AND user_key != ?`
          ).bind(clean, userKey).first();
          if (conflict) {
            return new Response(
              JSON.stringify({ error: "Username already taken" }),
              { status: 409, headers: { ...cors, "Content-Type": "application/json" } }
            );
          }
        }

        if (existing) {
          const prevXP       = existing[`${site}_xp`]      || 0;
          const prevMastered = existing[`${site}_mastered`] || 0;

          if (xp < prevXP) {
            return new Response(JSON.stringify({
              success: false, error: "XP cannot decrease",
              userKey, user: rowToUser(existing)
            }), { headers: { ...cors, "Content-Type": "application/json" } });
          }
          if (xp - prevXP > MAX_XP_JUMP) {
            return new Response(JSON.stringify({
              success: false, error: "XP jump too large, dont edit your files you naughty boy!",
              userKey, user: rowToUser(existing)
            }), { headers: { ...cors, "Content-Type": "application/json" } });
          }
          if (mastered - prevMastered > MAX_MASTERED_JUMP) {
            return new Response(JSON.stringify({
              success: false, error: "Mastered jump too large, dont edit your files you naughty boy!",
              userKey, user: rowToUser(existing)
            }), { headers: { ...cors, "Content-Type": "application/json" } });
          }
          if (mastered < prevMastered) mastered = prevMastered;
        }

        const storedIds = JSON.parse(existing?.[`${site}_mastered_ids`] || "[]");
        const mergedIds = [...new Set([...storedIds, ...incomingIds])].slice(0, 2000);

        const storedPendingIds   = JSON.parse(existing?.[`${site}_pending_ids`]  || "[]");
        const storedPendingData  = JSON.parse(existing?.[`${site}_pending_data`] || "[]");
        const storedRejectedIds  = JSON.parse(existing?.[`${site}_rejected_ids`] || "[]");

        const newPendingIds  = incomingPendingIds  !== null ? incomingPendingIds  : storedPendingIds;
        const newPendingData = incomingPendingData !== null ? incomingPendingData : storedPendingData;

        const newTheme = (theme !== undefined && theme !== null) ? theme : (existing?.theme || "");

        const qv_mastered     = site === "qv" ? mastered     : (existing?.qv_mastered || 0);
        const dv_mastered     = site === "dv" ? mastered     : (existing?.dv_mastered || 0);
        const qv_xp           = site === "qv" ? xp           : (existing?.qv_xp || 0);
        const dv_xp           = site === "dv" ? xp           : (existing?.dv_xp || 0);
        const qv_mastered_ids = site === "qv" ? JSON.stringify(mergedIds) : (existing?.qv_mastered_ids || "[]");
        const dv_mastered_ids = site === "dv" ? JSON.stringify(mergedIds) : (existing?.dv_mastered_ids || "[]");
        const qv_pending_ids  = site === "qv" ? JSON.stringify(newPendingIds)  : (existing?.qv_pending_ids  || "[]");
        const dv_pending_ids  = site === "dv" ? JSON.stringify(newPendingIds)  : (existing?.dv_pending_ids  || "[]");
        const qv_pending_data = site === "qv" ? JSON.stringify(newPendingData) : (existing?.qv_pending_data || "[]");
        const dv_pending_data = site === "dv" ? JSON.stringify(newPendingData) : (existing?.dv_pending_data || "[]");
        const qv_rejected_ids = existing?.qv_rejected_ids || "[]";
        const dv_rejected_ids = existing?.dv_rejected_ids || "[]";
        const updated_at      = new Date().toISOString();

        await env.DB.prepare(`
          INSERT INTO users (user_key, username, qv_mastered, dv_mastered, qv_xp, dv_xp,
            qv_mastered_ids, dv_mastered_ids,
            qv_pending_ids, dv_pending_ids, qv_pending_data, dv_pending_data,
            qv_rejected_ids, dv_rejected_ids, theme, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_key) DO UPDATE SET
            username=excluded.username,
            qv_mastered=excluded.qv_mastered, dv_mastered=excluded.dv_mastered,
            qv_xp=excluded.qv_xp, dv_xp=excluded.dv_xp,
            qv_mastered_ids=excluded.qv_mastered_ids, dv_mastered_ids=excluded.dv_mastered_ids,
            qv_pending_ids=excluded.qv_pending_ids, dv_pending_ids=excluded.dv_pending_ids,
            qv_pending_data=excluded.qv_pending_data, dv_pending_data=excluded.dv_pending_data,
            qv_rejected_ids=excluded.qv_rejected_ids, dv_rejected_ids=excluded.dv_rejected_ids,
            theme=excluded.theme, updated_at=excluded.updated_at
        `).bind(
          userKey, clean, qv_mastered, dv_mastered, qv_xp, dv_xp,
          qv_mastered_ids, dv_mastered_ids,
          qv_pending_ids, dv_pending_ids, qv_pending_data, dv_pending_data,
          qv_rejected_ids, dv_rejected_ids, newTheme, updated_at
        ).run();

        const user = {
          userKey, username: clean,
          qv_mastered, dv_mastered, qv_xp, dv_xp,
          streak:      existing?.streak     || 0,
          max_streak:  existing?.max_streak || 0,
          qv_mastered_ids: JSON.parse(qv_mastered_ids),
          dv_mastered_ids: JSON.parse(dv_mastered_ids),
          qv_pending_ids:  JSON.parse(qv_pending_ids),
          dv_pending_ids:  JSON.parse(dv_pending_ids),
          qv_pending_data: JSON.parse(qv_pending_data),
          dv_pending_data: JSON.parse(dv_pending_data),
          qv_rejected_ids: JSON.parse(qv_rejected_ids),
          dv_rejected_ids: JSON.parse(dv_rejected_ids),
          theme:           newTheme,
          updatedAt:       updated_at,
        };
        return new Response(JSON.stringify({ success: true, userKey, user }), {
          headers: { ...cors, "Content-Type": "application/json" }
        });

      } else {
        const conflict = await env.DB.prepare(
          `SELECT user_key FROM users WHERE LOWER(username) = LOWER(?)`
        ).bind(clean).first();
        if (conflict) {
          return new Response(
            JSON.stringify({ error: "Username already taken" }),
            { status: 409, headers: { ...cors, "Content-Type": "application/json" } }
          );
        }

        const kvKey      = crypto.randomUUID();
        const updated_at = new Date().toISOString();
        const qv_mastered_ids = site === "qv" ? JSON.stringify(incomingIds) : "[]";
        const dv_mastered_ids = site === "dv" ? JSON.stringify(incomingIds) : "[]";
        const qv_pending_ids  = site === "qv" && incomingPendingIds ? JSON.stringify(incomingPendingIds) : "[]";
        const dv_pending_ids  = site === "dv" && incomingPendingIds ? JSON.stringify(incomingPendingIds) : "[]";
        const qv_pending_data = site === "qv" && incomingPendingData ? JSON.stringify(incomingPendingData) : "[]";
        const dv_pending_data = site === "dv" && incomingPendingData ? JSON.stringify(incomingPendingData) : "[]";
        const newTheme = theme || "";

        await env.DB.prepare(`
          INSERT INTO users (user_key, username, qv_mastered, dv_mastered, qv_xp, dv_xp,
            qv_mastered_ids, dv_mastered_ids,
            qv_pending_ids, dv_pending_ids, qv_pending_data, dv_pending_data,
            qv_rejected_ids, dv_rejected_ids, theme, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?)
        `).bind(
          kvKey, clean,
          site === "qv" ? mastered : 0,
          site === "dv" ? mastered : 0,
          site === "qv" ? xp : 0,
          site === "dv" ? xp : 0,
          qv_mastered_ids, dv_mastered_ids,
          qv_pending_ids, dv_pending_ids, qv_pending_data, dv_pending_data,
          newTheme, updated_at
        ).run();

        const user = {
          userKey: kvKey, username: clean,
          qv_mastered: site === "qv" ? mastered : 0,
          dv_mastered: site === "dv" ? mastered : 0,
          qv_xp: site === "qv" ? xp : 0,
          dv_xp: site === "dv" ? xp : 0,
          streak:     0,
          max_streak: 0,
          qv_mastered_ids: site === "qv" ? incomingIds : [],
          dv_mastered_ids: site === "dv" ? incomingIds : [],
          qv_pending_ids:  site === "qv" && incomingPendingIds ? incomingPendingIds : [],
          dv_pending_ids:  site === "dv" && incomingPendingIds ? incomingPendingIds : [],
          qv_pending_data: site === "qv" && incomingPendingData ? incomingPendingData : [],
          dv_pending_data: site === "dv" && incomingPendingData ? incomingPendingData : [],
          qv_rejected_ids: [],
          dv_rejected_ids: [],
          theme:           newTheme,
          updatedAt:       updated_at,
        };
        return new Response(JSON.stringify({ success: true, userKey: kvKey, user }), {
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }
    }

    // ── POST /lb/update-theme — lightweight theme-only update ─────────────────
    if (url.pathname === "/lb/update-theme" && request.method === "POST") {
      const body = await request.json();
      const { userKey, theme } = body;
      if (!userKey || theme === undefined) {
        return new Response("Missing fields", { status: 400, headers: cors });
      }
      const account = await env.DB.prepare("SELECT user_key FROM users WHERE user_key = ?").bind(userKey).first();
      if (!account) return new Response("Account not found", { status: 404, headers: cors });
      try {
        await env.DB.prepare(
          `UPDATE users SET theme=?, updated_at=? WHERE user_key=?`
        ).bind(theme, new Date().toISOString(), userKey).run();
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...cors, "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }
    }

    if (url.pathname === "/lb/streak" && request.method === "POST") {
      const body = await request.json();
      const { userKey, streak, max_streak } = body;
      if (!userKey) {
        return new Response("Missing userKey", { status: 400, headers: cors });
      }
      const account = await env.DB.prepare("SELECT user_key FROM users WHERE user_key = ?").bind(userKey).first();
      if (!account) return new Response("Account not found", { status: 404, headers: cors });
      const safeStreak = Math.max(0, Math.min(10000, Math.floor(Number(streak) || 0)));
      const safeMaxStreak = Math.max(safeStreak, Math.min(10000, Math.floor(Number(max_streak) || 0)));
      try {
        await env.DB.prepare(
          `UPDATE users
           SET streak = ?,
               max_streak = CASE WHEN ? > COALESCE(max_streak, 0) THEN ? ELSE COALESCE(max_streak, 0) END,
               updated_at = ?
           WHERE user_key = ?`
        ).bind(safeStreak, safeMaxStreak, safeMaxStreak, new Date().toISOString(), userKey).run();
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...cors, "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // CUSTOM THEMES — stored in THEMES KV, keyed by "theme:{userKey}:{themeKey}"
    //
    // Requires a KV namespace bound as env.THEMES in wrangler.toml:
    //   [[kv_namespaces]]
    //   binding = "THEMES"
    //   id = "<your-kv-namespace-id>"
    // ════════════════════════════════════════════════════════════════════════

    if (url.pathname === "/themes/save" && request.method === "POST") {
      const body = await request.json();
      const { userKey, key, theme } = body;
      if (!userKey || !key || !theme) {
        return new Response("Missing fields", { status: 400, headers: cors });
      }
      if (!/^[a-zA-Z0-9_]{1,80}$/.test(String(key))) {
        return new Response("Invalid key", { status: 400, headers: cors });
      }
      const account = await env.DB.prepare("SELECT user_key FROM users WHERE user_key = ?").bind(userKey).first();
      if (!account) return new Response("Account not found", { status: 404, headers: cors });
      const safeTheme = { label: String(theme.label || "").slice(0, 60), desc: String(theme.desc || "").slice(0, 120) };
      Object.entries(theme).forEach(([name, value]) => {
        if (name.startsWith("--")) safeTheme[name] = String(value).slice(0, 80);
      });
      const updatedAt = new Date().toISOString();
      await env.DB.prepare(
        "INSERT INTO custom_themes (user_key, theme_key, theme_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_key, theme_key) DO UPDATE SET theme_json = excluded.theme_json, updated_at = excluded.updated_at"
      ).bind(userKey, key, JSON.stringify(safeTheme), updatedAt).run();
      await env.THEMES.put(`theme:${userKey}:${key}`, JSON.stringify(safeTheme));
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/themes/list" && request.method === "GET") {
      const userKey = url.searchParams.get("userKey");
      if (!userKey) return new Response("Missing userKey", { status: 400, headers: cors });
      const account = await env.DB.prepare("SELECT user_key FROM users WHERE user_key = ?").bind(userKey).first();
      if (!account) return new Response("Account not found", { status: 404, headers: cors });
      const prefix = `theme:${userKey}:`;
      let cursor;
      do {
        const page = await env.THEMES.list({ prefix, ...(cursor ? { cursor } : {}) });
        for (const item of page.keys) {
          const value = await env.THEMES.get(item.name, "json");
          if (!value) continue;
          const themeKey = item.name.slice(prefix.length);
          if (!/^[a-zA-Z0-9_]{1,80}$/.test(themeKey)) continue;
          await env.DB.prepare(
            "INSERT OR IGNORE INTO custom_themes (user_key, theme_key, theme_json, updated_at) VALUES (?, ?, ?, ?)"
          ).bind(userKey, themeKey, JSON.stringify(value), new Date().toISOString()).run();
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      const { results } = await env.DB.prepare(
        "SELECT theme_key, theme_json FROM custom_themes WHERE user_key = ? ORDER BY theme_key"
      ).bind(userKey).all();
      const themes = {};
      for (const row of results) themes[row.theme_key] = JSON.parse(row.theme_json);
      return new Response(JSON.stringify({ themes }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/themes/delete" && request.method === "POST") {
      const body = await request.json();
      const { userKey, key } = body;
      if (!userKey || !key) return new Response("Missing fields", { status: 400, headers: cors });
      if (!/^[a-zA-Z0-9_]{1,80}$/.test(String(key))) return new Response("Invalid key", { status: 400, headers: cors });
      const account = await env.DB.prepare("SELECT user_key FROM users WHERE user_key = ?").bind(userKey).first();
      if (!account) return new Response("Account not found", { status: 404, headers: cors });
      await env.THEMES.delete(`theme:${userKey}:${key}`);
      await env.DB.prepare("DELETE FROM custom_themes WHERE user_key = ? AND theme_key = ?").bind(userKey, key).run();
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ── FEEDBACK SUBMIT ──────────────────────────────────────────────────────
    if (url.pathname === "/feedback/submit" && request.method === "POST") {
      const body = await request.json();
      const sanitize = (str) => String(str || "").replace(/[<>]/g, "").trim();
      const type = sanitize(body.type);
      const title = sanitize(body.title);
      const description = sanitize(body.description);
      if (!type || !title || !description) {
        return new Response(JSON.stringify({ success: false, error: "Missing required fields" }), {
          status: 400, headers: { ...cors, "Content-Type": "application/json" }
        });
      }
      const id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
      const record = {
        id, type, title, description,
        device: sanitize(body.device),
        browser: sanitize(body.browser),
        appVersion: sanitize(body.appVersion),
        sourceApplication: sanitize(body.sourceApplication),
        timestamp: new Date().toISOString()
      };
      await env.FEEDBACK.put(id, JSON.stringify(record));
      return new Response(JSON.stringify({ success: true, id }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ── FEEDBACK LIST (admin only) ───────────────────────────────────────────
    if (url.pathname === "/feedback/list" && request.method === "GET") {
      if (!await isAuthorized(url, request)) {
        return new Response("Unauthorized", { status: 401, headers: cors });
      }

      const items = [];
      let cursor;
      do {
        const page = await env.FEEDBACK.list(cursor ? { cursor } : {});
        for (const key of page.keys) {
          const value = await env.FEEDBACK.get(key.name, "json");
          if (value) items.push(value);
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);

      items.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
      return new Response(JSON.stringify({ items }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/feedback/update" && request.method === "POST") {
      if (!await isAuthorized(url, request)) return new Response("Unauthorized", { status: 401, headers: cors });
      const body = await request.json();
      const id = String(body.id || "").trim();
      const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : null;
      if (!id || !data) return new Response("Missing id or data", { status: 400, headers: cors });
      const existing = await env.FEEDBACK.get(id, "json");
      if (!existing) return new Response("Feedback not found", { status: 404, headers: cors });
      const clean = value => String(value ?? "").replace(/[<>]/g, "").trim().slice(0, 10000);
      const updated = {
        ...existing,
        type: clean(data.type ?? existing.type).slice(0, 80),
        title: clean(data.title ?? existing.title).slice(0, 200),
        description: clean(data.description ?? existing.description),
        device: clean(data.device ?? existing.device).slice(0, 200),
        browser: clean(data.browser ?? existing.browser).slice(0, 200),
        appVersion: clean(data.appVersion ?? existing.appVersion).slice(0, 100),
        sourceApplication: clean(data.sourceApplication ?? existing.sourceApplication).slice(0, 100),
        id,
        timestamp: existing.timestamp
      };
      if (!updated.type || !updated.title || !updated.description) return new Response("Type, title and description are required.", { status: 400, headers: cors });
      await env.FEEDBACK.put(id, JSON.stringify(updated));
      return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ── FEEDBACK DELETE (admin only) ──────────────────────────────────────────
    if (url.pathname === "/feedback/delete" && request.method === "POST") {
      if (!await isAuthorized(url, request)) {
        return new Response("Unauthorized", { status: 401, headers: cors });
      }

      const body = await request.json();
      const id = String(body.id || '').trim();
      if (!id) {
        return new Response("Missing id", { status: 400, headers: cors });
      }

      await env.FEEDBACK.delete(id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // ── REVISION DATA ────────────────────────────────────────────────────────
    if (url.pathname === "/review-schedules" && (request.method === "GET" || request.method === "POST")) {
      const session = await getAccountSession(request);
      if (!session || !(await verifyPasswordAccountAccess(session.user_key, request))) return new Response("Sign in with a password account to sync review schedules.", { status: 401, headers: cors });
      const site = request.method === "GET" ? String(url.searchParams.get("site") || "") : String((await request.clone().json()).site || "");
      if (!["qv", "dv"].includes(site)) return new Response("Invalid site", { status: 400, headers: cors });
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS review_schedules (user_key TEXT NOT NULL, site TEXT NOT NULL, schedules_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_key, site))").bind().run();
      if (request.method === "GET") {
        const row = await env.DB.prepare("SELECT schedules_json, updated_at FROM review_schedules WHERE user_key = ? AND site = ?").bind(session.user_key, site).first();
        let schedules = {};
        try { schedules = row ? JSON.parse(row.schedules_json || "{}") : {}; } catch {}
        return new Response(JSON.stringify({ found: Boolean(row), schedules, updatedAt: row?.updated_at || null }), { headers: { ...cors, "Content-Type": "application/json" } });
      }
      const body = await request.json();
      const incoming = body.schedules && typeof body.schedules === "object" && !Array.isArray(body.schedules) ? body.schedules : null;
      if (!incoming) return new Response("Invalid schedules", { status: 400, headers: cors });
      const row = await env.DB.prepare("SELECT schedules_json FROM review_schedules WHERE user_key = ? AND site = ?").bind(session.user_key, site).first();
      let merged = {};
      try { merged = row ? JSON.parse(row.schedules_json || "{}") : {}; } catch {}
      for (const [id, schedule] of Object.entries(incoming).slice(0, 10000)) {
        if (!id || !schedule || typeof schedule !== "object" || Array.isArray(schedule)) continue;
        const current = merged[id];
        const incomingAt = String(schedule.updatedAt || "");
        const currentAt = String(current?.updatedAt || "");
        if (!current || (incomingAt && incomingAt >= currentAt)) merged[id] = schedule;
      }
      const updatedAt = new Date().toISOString();
      await env.DB.prepare("INSERT INTO review_schedules (user_key, site, schedules_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_key, site) DO UPDATE SET schedules_json=excluded.schedules_json, updated_at=excluded.updated_at").bind(session.user_key, site, JSON.stringify(merged), updatedAt).run();
      return new Response(JSON.stringify({ success: true, schedules: merged, updatedAt }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/revision/sync" && request.method === "GET") {
      const userKey = url.searchParams.get("userKey");
      if (!userKey) return new Response("Missing userKey", { status: 400, headers: cors });
      const account = await env.DB.prepare(
        "SELECT username FROM users WHERE user_key = ?"
      ).bind(userKey).first();
      if (!account) return new Response("Account not found", { status: 404, headers: cors });
      if (!(await verifyPasswordAccountAccess(userKey, request))) return new Response("Sign in with a password account to sync Revision.", { status: 401, headers: cors });
      let row = await env.DB.prepare(
        "SELECT data_json, updated_at FROM revision_sync_data WHERE user_key = ?"
      ).bind(userKey).first();
      if (!row) {
        const legacy = await env.REVISION.get(`user:${userKey}`, "json");
        if (legacy) {
          await env.DB.prepare(
            "INSERT OR IGNORE INTO revision_sync_data (user_key, data_json, updated_at) VALUES (?, ?, ?)"
          ).bind(userKey, JSON.stringify(legacy), String(legacy.updatedAt || new Date().toISOString())).run();
          row = await env.DB.prepare(
            "SELECT data_json, updated_at FROM revision_sync_data WHERE user_key = ?"
          ).bind(userKey).first();
        }
      }
      const data = row ? { ...JSON.parse(row.data_json), updatedAt: row.updated_at } : null;
      return new Response(JSON.stringify({ found: Boolean(data), data }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/revision/sync" && request.method === "POST") {
      const body = await request.json();
      const userKey = String(body.userKey || "").trim();
      const username = String(body.username || "").trim().slice(0, 20);
      if (!userKey || !username) return new Response("Missing userKey or username", { status: 400, headers: cors });
      const account = await env.DB.prepare(
        "SELECT username FROM users WHERE user_key = ?"
      ).bind(userKey).first();
      if (!account || account.username.toLowerCase() !== username.toLowerCase()) {
        return new Response("Account verification failed", { status: 403, headers: cors });
      }
      if (!(await verifyPasswordAccountAccess(userKey, request))) return new Response("Sign in with a password account to sync Revision.", { status: 401, headers: cors });
      let existingRow = await env.DB.prepare(
        "SELECT data_json, updated_at FROM revision_sync_data WHERE user_key = ?"
      ).bind(userKey).first();
      if (!existingRow) {
        const legacy = await env.REVISION.get(`user:${userKey}`, "json");
        if (legacy) {
          await env.DB.prepare(
            "INSERT OR IGNORE INTO revision_sync_data (user_key, data_json, updated_at) VALUES (?, ?, ?)"
          ).bind(userKey, JSON.stringify(legacy), String(legacy.updatedAt || new Date().toISOString())).run();
          existingRow = await env.DB.prepare(
            "SELECT data_json, updated_at FROM revision_sync_data WHERE user_key = ?"
          ).bind(userKey).first();
        }
      }
      const existing = existingRow ? { ...JSON.parse(existingRow.data_json), updatedAt: existingRow.updated_at } : null;
      const expectedUpdatedAt = String(body.expectedUpdatedAt || "");
      const currentUpdatedAt = existingRow ? String(existingRow.updated_at || existing.updatedAt || "") : "";
      if ((existingRow && expectedUpdatedAt !== currentUpdatedAt) || (!existingRow && expectedUpdatedAt)) {
        return new Response(JSON.stringify({ conflict: true, data: existing }), {
          status: 409,
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }
      const accountSets = Array.isArray(body.accountSets)
        ? body.accountSets.slice(0, 25).map((set, index) => ({
            id: String(set && set.id ? set.id : `set-${index + 1}`),
            name: String(set && set.name ? set.name : `Set ${index + 1}`).slice(0, 80),
            cards: Array.isArray(set && set.cards) ? set.cards.slice(0, 2000) : [],
            progress: set && set.progress && typeof set.progress === "object" ? set.progress : {},
            xp: Math.max(0, Number(set && set.xp) || 0),
            streak: Math.max(0, Number(set && set.streak) || 0),
            lastReview: String(set && set.lastReview ? set.lastReview : ""),
            published: Boolean(set && set.published),
            syllabus: Array.isArray(set && set.syllabus) ? set.syllabus.slice(0, 200) : [],
            syllabusDone: set && set.syllabusDone && typeof set.syllabusDone === "object" ? set.syllabusDone : {},
            reviewLog: Array.isArray(set && set.reviewLog) ? set.reviewLog.slice(-5000) : [],
            practice: set && set.practice && typeof set.practice === "object" ? {
              catalogues: Object.fromEntries(Object.entries(set.practice.catalogues || {}).slice(0, 8).map(([id, catalogue]) => [String(id).slice(0, 100), {
                id: String(catalogue.id || id).slice(0, 100),
                subject: String(catalogue.subject || "").slice(0, 100),
                examBoard: String(catalogue.examBoard || "").slice(0, 80),
                qualification: String(catalogue.qualification || "").slice(0, 100),
                source: String(catalogue.source || "").slice(0, 300),
                optionalModule: catalogue.optionalModule && typeof catalogue.optionalModule === "object" ? { status: String(catalogue.optionalModule.status || "").slice(0, 40), note: String(catalogue.optionalModule.note || "").slice(0, 300) } : null,
                topics: Array.isArray(catalogue.topics) ? catalogue.topics.slice(0, 250).map(topic => ({
                  id: String(topic.id || "").slice(0, 100),
                  name: String(topic.name || "").slice(0, 160),
                  year: String(topic.year || "").slice(0, 30),
                  area: String(topic.area || "").slice(0, 80),
                  subtopics: Array.isArray(topic.subtopics) ? topic.subtopics.slice(0, 100).map(item => String(item).slice(0, 180)) : []
                })) : [],
                updatedAt: Number(catalogue.updatedAt) || 0
              }])),
              attempts: Array.isArray(set.practice.attempts) ? set.practice.attempts.slice(-1000).map(item => ({
                id: String(item.id || "").slice(0, 100), subjectId: String(item.subjectId || "").slice(0, 100), topicId: String(item.topicId || "").slice(0, 100),
                topic: String(item.topic || "").slice(0, 160), marks: Math.max(0, Math.min(10000, Number(item.marks) || 0)), maxMarks: Math.max(0, Math.min(10000, Number(item.maxMarks) || 0)),
                source: String(item.source || "").slice(0, 160), notes: String(item.notes || "").slice(0, 1200), at: Number(item.at) || 0
              })) : [],
              mistakes: Array.isArray(set.practice.mistakes) ? set.practice.mistakes.slice(-1000).map(item => ({
                id: String(item.id || "").slice(0, 100), subjectId: String(item.subjectId || "").slice(0, 100), topicId: String(item.topicId || "").slice(0, 100),
                topic: String(item.topic || "").slice(0, 160), description: String(item.description || "").slice(0, 1200), source: String(item.source || "").slice(0, 160),
                at: Number(item.at) || 0, resolved: Boolean(item.resolved), resolvedAt: Number(item.resolvedAt) || 0
              })) : [],
              formulas: Array.isArray(set.practice.formulas) ? set.practice.formulas.slice(-300).map(item => ({
                id: String(item.id || "").slice(0, 100), subjectId: String(item.subjectId || "").slice(0, 100), topicId: String(item.topicId || "").slice(0, 100),
                name: String(item.name || "").slice(0, 120), expression: String(item.expression || "").slice(0, 300), units: String(item.units || "").slice(0, 160), conditions: String(item.conditions || "").slice(0, 300)
              })) : [],
               resources: Array.isArray(set.practice.resources) ? set.practice.resources.slice(-500).map(item => ({
                 id: String(item.id || "").slice(0, 100), subject: String(item.subject || "").slice(0, 100), subjectId: String(item.subjectId || "").slice(0, 100), topicId: String(item.topicId || "").slice(0, 100),
                 topic: String(item.topic || "").slice(0, 160), kind: String(item.kind || "notes").slice(0, 40), title: String(item.title || "").slice(0, 180), content: String(item.content || "").slice(0, 12000), source: String(item.source || "").slice(0, 300)
               })) : [],
            } : { catalogues: {}, attempts: [], mistakes: [], formulas: [], resources: [] }
          }))
        : [];
      const activeSetId = String(body.activeSetId || accountSets[0]?.id || "default").trim();
      const updatedAt = existingRow ? new Date(Math.max(Date.now(), Date.parse(currentUpdatedAt || 0) + 1)).toISOString() : new Date().toISOString();
      const data = {
        username,
        cards: Array.isArray(body.cards) ? body.cards.slice(0, 2000) : [],
        progress: body.progress && typeof body.progress === "object" ? body.progress : {},
        accountSets,
        activeSetId,
        xp: Math.max(0, Math.min(1000000, Number(body.xp) || 0)),
        streak: Math.max(0, Math.min(10000, Number(body.streak) || 0)),
        lastReview: String(body.lastReview || ""),
        updatedAt
      };
      let write;
      if (existingRow) {
        write = await env.DB.prepare(
          "UPDATE revision_sync_data SET data_json = ?, updated_at = ? WHERE user_key = ? AND updated_at = ?"
        ).bind(JSON.stringify(data), data.updatedAt, userKey, currentUpdatedAt).run();
      } else {
        write = await env.DB.prepare(
          "INSERT OR IGNORE INTO revision_sync_data (user_key, data_json, updated_at) VALUES (?, ?, ?)"
        ).bind(userKey, JSON.stringify(data), data.updatedAt).run();
      }
      if (write.meta && write.meta.changes === 0) {
        const latestRow = await env.DB.prepare(
          "SELECT data_json, updated_at FROM revision_sync_data WHERE user_key = ?"
        ).bind(userKey).first();
        return new Response(JSON.stringify({ conflict: true, data: latestRow ? { ...JSON.parse(latestRow.data_json), updatedAt: latestRow.updated_at } : null }), {
          status: 409,
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }
      await env.DB.prepare(
        "INSERT INTO revision_leaderboard (user_key, username, xp, streak, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_key) DO UPDATE SET username = excluded.username, xp = excluded.xp, streak = excluded.streak, updated_at = excluded.updated_at"
      ).bind(userKey, username, data.xp, data.streak, data.updatedAt).run();
      try {
        await env.REVISION.put(`user:${userKey}`, JSON.stringify(data));
        await env.REVISION.put(`leaderboard:${userKey}`, JSON.stringify({ userKey, username, xp: data.xp, streak: data.streak, updatedAt: data.updatedAt }));
      } catch {}
      return new Response(JSON.stringify({ success: true, data }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/revision/leaderboard" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT username, xp, streak, updated_at AS updatedAt FROM revision_leaderboard ORDER BY xp DESC, updated_at DESC LIMIT 100"
      ).all();
      return new Response(JSON.stringify({ users: results }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/revision/public" && request.method === "GET") {
      const requesterKey = url.searchParams.get("userKey") || "";
      const notes = [];
      let cursor;
      do {
        const page = await env.REVISION.list({ prefix: "public:", ...(cursor ? { cursor } : {}) });
        for (const key of page.keys) {
          const value = await env.REVISION.get(key.name, "json");
          if (value) {
            const { ownerKey, submittedBy, submittedAt, originalSubmission, ...publicValue } = value;
            notes.push({ ...publicValue, owned: Boolean(requesterKey && ownerKey === requesterKey) });
          }
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      notes.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      return new Response(JSON.stringify({ notes: notes.slice(0, 100) }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/revision/public" && request.method === "POST") {
      const body = await request.json();
      const userKey = String(body.userKey || "").trim();
      const note = body.note && typeof body.note === "object" ? body.note : null;
      if (!userKey || !note) return new Response("Missing userKey or note", { status: 400, headers: cors });
      if (!(await verifyPasswordAccountAccess(userKey, request))) return new Response("A signed-in password account is required to publish notes.", { status: 401, headers: cors });
      const account = await env.DB.prepare("SELECT username FROM users WHERE user_key = ?").bind(userKey).first();
      if (!account) return new Response("Account not found", { status: 404, headers: cors });
      const id = `rn-${crypto.randomUUID()}`;
      const publicNote = { id, ownerKey: userKey, submittedBy: account.username, submittedAt: new Date().toISOString(), title: String(note.title || "Untitled notes").slice(0, 120), subject: String(note.subject || "General").slice(0, 80), level: String(note.level || "").slice(0, 50), cards: Array.isArray(note.cards) ? note.cards.slice(0, 500) : [], updatedAt: new Date().toISOString() };
      await env.REVISION.put(`public-pending:${id}`, JSON.stringify(publicNote));
      return new Response(JSON.stringify({ success: true, pending: true, note: publicNote }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/revision/public/pending" && request.method === "GET") {
      if (!await isAuthorized(url, request)) return new Response("Unauthorized", { status: 401, headers: cors });
      const notes = [];
      let cursor;
      do {
        const page = await env.REVISION.list({ prefix: "public-pending:", ...(cursor ? { cursor } : {}) });
        for (const key of page.keys) {
          const value = await env.REVISION.get(key.name, "json");
          if (value) notes.push(value);
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      return new Response(JSON.stringify({ notes }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/revision/public/admin-list" && request.method === "GET") {
      if (!await isAuthorized(url, request)) return new Response("Unauthorized", { status: 401, headers: cors });
      const notes = [];
      for (const prefix of ["public:", "public-pending:"]) {
        let cursor;
        do {
          const page = await env.REVISION.list({ prefix, ...(cursor ? { cursor } : {}) });
          for (const key of page.keys) {
            const value = await env.REVISION.get(key.name, "json");
            if (value) notes.push({ ...value, submittedBy: value.submittedBy || "Legacy submission", submittedAt: value.submittedAt || value.updatedAt, pending: prefix === "public-pending:" });
          }
          cursor = page.list_complete ? null : page.cursor;
        } while (cursor);
      }
      return new Response(JSON.stringify({ notes }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/revision/public/approve" && request.method === "POST") {
      const actor = await getSessionUser(url, request);
      if (!actor) return new Response("Unauthorized", { status: 401, headers: cors });
      const body = await request.json();
      const id = String(body.id || "").trim();
      const note = id ? await env.REVISION.get(`public-pending:${id}`, "json") : null;
      if (!note) return new Response("Note not found", { status: 404, headers: cors });
      await env.REVISION.put(`public:${id}`, JSON.stringify(note));
      await createSubmissionNotification("revision", id, note, "approved", note);
      await recordApproval("revision-note", id, note, actor);
      await env.REVISION.delete(`public-pending:${id}`);
      return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/revision/public/reject" && request.method === "POST") {
      if (!await isAuthorized(url, request)) return new Response("Unauthorized", { status: 401, headers: cors });
      const body = await request.json();
      const id = String(body.id || "").trim();
      if (!id) return new Response("Missing id", { status: 400, headers: cors });
      const note = await env.REVISION.get(`public-pending:${id}`, "json");
      if (!note) return new Response("Note not found", { status: 404, headers: cors });
      const actor = await getSessionUser(url, request);
      await createSubmissionNotification("revision", id, note, "denied");
      await recordModerationAction("revision-note", id, note, actor, "denied");
      await env.REVISION.delete(`public-pending:${id}`);
      return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/revision/public/update" && request.method === "POST") {
      if (!await isAuthorized(url, request)) return new Response("Unauthorized", { status: 401, headers: cors });
      const body = await request.json();
      const id = String(body.id || "").trim();
      const note = body.note && typeof body.note === "object" ? body.note : null;
      if (!id || !note) return new Response("Missing id or note", { status: 400, headers: cors });
      const publicKey = `public:${id}`;
      const pendingKey = `public-pending:${id}`;
      const existing = await env.REVISION.get(publicKey, "json");
      const existingPending = existing ? null : await env.REVISION.get(pendingKey, "json");
      const current = existing || existingPending;
      if (!current) return new Response("Note not found", { status: 404, headers: cors });
      const updated = { ...current, originalSubmission: current.originalSubmission || { title: current.title, subject: current.subject, level: current.level, cards: current.cards }, title: String(note.title || current.title).slice(0, 120), subject: String(note.subject || current.subject || "General").slice(0, 80), level: String(note.level || current.level || "").slice(0, 50), cards: Array.isArray(note.cards) ? note.cards.slice(0, 500) : current.cards, updatedAt: new Date().toISOString() };
      await env.REVISION.put(existing ? publicKey : pendingKey, JSON.stringify(updated));
      return new Response(JSON.stringify({ success: true, note: updated }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/revision/public/admin-delete" && request.method === "POST") {
      if (!await isAuthorized(url, request)) return new Response("Unauthorized", { status: 401, headers: cors });
      const body = await request.json();
      const id = String(body.id || "").trim();
      if (!id) return new Response("Missing id", { status: 400, headers: cors });
      const note = await env.REVISION.get(`public:${id}`, "json") || await env.REVISION.get(`public-pending:${id}`, "json");
      if (note) await recordModerationAction("revision-note", id, note, await getSessionUser(url, request), "removed");
      await env.REVISION.delete(`public:${id}`);
      await env.REVISION.delete(`public-pending:${id}`);
      return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/revision/public/delete" && request.method === "POST") {
      const body = await request.json();
      const userKey = String(body.userKey || "").trim();
      const id = String(body.id || "").trim();
      const note = id ? await env.REVISION.get(`public:${id}`, "json") : null;
      if (!userKey || !id) return new Response("Missing fields", { status: 400, headers: cors });
      const account = await env.DB.prepare("SELECT user_key FROM users WHERE user_key = ?").bind(userKey).first();
      if (!account) return new Response("Account not found", { status: 404, headers: cors });
      if (!note) return new Response("Note not found", { status: 404, headers: cors });
      if (note.ownerKey !== userKey) return new Response("Forbidden", { status: 403, headers: cors });
      await env.REVISION.delete(`public:${id}`);
      return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ── REVISION STUDY GUIDE GENERATOR (admin only) ──────────────────────────
    if (url.pathname === "/generate" && request.method === "POST") {
      if (!await getAIUser(request)) {
        return new Response("Unauthorized", { status: 401, headers: cors });
      }
      let body;
      try { body = await request.json(); } catch {
        return new Response(JSON.stringify({ error: "Missing 'material' field in request body." }), {
          status: 400, headers: { ...cors, "Content-Type": "application/json" }
        });
      }
      if (typeof body.material !== "string" || !body.material.trim()) {
        return new Response(JSON.stringify({ error: "Missing 'material' field in request body." }), {
          status: 400, headers: { ...cors, "Content-Type": "application/json" }
        });
      }

      const requestedCount = Math.max(5, Math.min(100, Math.floor(Number(body.count) || 30)));
      const mode = ["new", "add", "links"].includes(body.mode) ? body.mode : "new";
      const flashcardSchema = { type: "array", items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, front: { type: "string" }, back: { type: "string" } }, required: ["id", "front", "back"] } };
      const linksSchema = { type: "array", items: { type: "object", additionalProperties: false, properties: { from_id: { type: "string" }, to_id: { type: "string" } }, required: ["from_id", "to_id"] } };
      const schema = mode === "links"
        ? { type: "object", properties: { links: linksSchema }, required: ["links"], additionalProperties: false }
        : { type: "object", properties: { flashcards: flashcardSchema, links: linksSchema }, required: ["flashcards", "links"], additionalProperties: false };
      const existingCards = Array.isArray(body.existingCards) ? body.existingCards.slice(0, 200) : [];
      const modeInstructions = mode === "links"
        ? `Return only a links array. Use the exact existing card IDs supplied by the user. Find useful, genuine relationships between different cards, including missing links; do not return flashcards.`
        : mode === "add"
          ? `Create up to ${requestedCount} additional flashcards that are not duplicates of the existing cards included in the context. Use new unique IDs beginning with n1, n2, and so on. Links may connect new cards to each other or to existing card IDs given in the context.`
          : `Aim for ${requestedCount} useful, non-repetitive flashcards; do not stop after only a few when the material supports more. Give every card a unique sequential ID (c1, c2, c3...).`;

      try {
        const result = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
          messages: [
            { role: "system", content: `Create comprehensive GCSE revision flashcards from the supplied material. Return only valid JSON matching the supplied schema. Do not include practice questions, commentary, summaries, self-corrections, caveats, repeated text, or extra keys. Fronts must be a term or concise concept (maximum 8 words), never a question. Backs must be a direct definition or explanation in at most 25 words. State each fact once. Cover distinct sections, subtopics, key terms, processes, causes, effects and comparisons. ${modeInstructions} Links must connect genuinely related cards, use only provided or returned IDs, never link a card to itself, and include useful connections without duplicating edges. Do not invent information.` },
            { role: "user", content: `${body.material.slice(0, 120000)}\n\nExisting cards for comparison/linking: ${JSON.stringify(existingCards).slice(0, 50000)}` }
          ],
          max_tokens: 8192,
          response_format: { type: "json_schema", json_schema: { name: "study_guide", schema } }
        });
        const choice = result?.choices?.[0];
        const content = choice?.message?.content;
        if (choice?.finish_reason === "length") {
          return new Response(JSON.stringify({ error: "The AI response reached its output limit before finishing the cards. Try a smaller card count or split the topic notes into sections." }), {
            status: 502, headers: { ...cors, "Content-Type": "application/json" }
          });
        }
        if (typeof content === "string") {
          try { JSON.parse(content); } catch {
            return new Response(JSON.stringify({ error: "The AI returned incomplete card data. Try a smaller card count or split the topic notes into sections." }), {
              status: 502, headers: { ...cors, "Content-Type": "application/json" }
            });
          }
        }
        return new Response(JSON.stringify(result), {
          headers: { ...cors, "Content-Type": "application/json" }
        });
      } catch (error) {
        const message = String(error?.message || error || "");
        const status = error?.status || error?.statusCode;
        if (status === 429 || message.includes("3036")) {
          return new Response(JSON.stringify({ error: "You've used today's free AI allocation. Please try again after midnight UTC." }), {
            status: 429, headers: { ...cors, "Content-Type": "application/json" }
          });
        }
        return new Response(JSON.stringify({ error: "Failed to generate study guide. Please try again." }), {
          status: 500, headers: { ...cors, "Content-Type": "application/json" }
        });
      }
    }

    return new Response("Not found", { status: 404, headers: cors });
  }
};

// ── Helper ────────────────────────────────────────────────────────────────────
function rowToUser(row) {
  return {
    userKey:          row.user_key,
    username:         row.username,
    qv_mastered:      row.qv_mastered,
    dv_mastered:      row.dv_mastered,
    qv_xp:            row.qv_xp,
    dv_xp:            row.dv_xp,
    streak:           row.streak     || 0,
    max_streak:       row.max_streak || 0,
    qv_mastered_ids:  JSON.parse(row.qv_mastered_ids  || "[]"),
    dv_mastered_ids:  JSON.parse(row.dv_mastered_ids  || "[]"),
    qv_pending_ids:   JSON.parse(row.qv_pending_ids   || "[]"),
    dv_pending_ids:   JSON.parse(row.dv_pending_ids   || "[]"),
    qv_pending_data:  JSON.parse(row.qv_pending_data  || "[]"),
    dv_pending_data:  JSON.parse(row.dv_pending_data  || "[]"),
    qv_rejected_ids:  JSON.parse(row.qv_rejected_ids  || "[]"),
    dv_rejected_ids:  JSON.parse(row.dv_rejected_ids  || "[]"),
    theme:            row.theme || "",
    updatedAt:        row.updated_at,
  };
}