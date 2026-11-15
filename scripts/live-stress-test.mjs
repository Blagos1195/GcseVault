import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const BASE_URL = (process.env.STRESS_BASE_URL || "https://quotevault-api.noah-l-barker.workers.dev").replace(/\/$/, "");
const COUNT = Number(process.env.STRESS_ACCOUNT_COUNT || 100);
const CONCURRENCY = Number(process.env.STRESS_CONCURRENCY || 10);
const PREFIX = "ST26";
const cleanupMode = process.argv[2] === "--cleanup";
const manifestArg = process.argv[3];

async function request(path, options = {}) {
  const response = await fetch(BASE_URL + path, {
    ...options,
    signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path}: HTTP ${response.status} ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function runPool(items, limit, task) {
  let next = 0;
  const results = new Array(items.length);
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await task(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error: error.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

if (cleanupMode) {
  if (!manifestArg) throw new Error("Usage: node scripts/live-stress-test.mjs --cleanup <manifest.json>");
  const manifest = JSON.parse(await readFile(resolve(manifestArg), "utf8"));
  const keys = [...new Set(manifest.accounts.map(account => account.userKey))];
  if (!keys.length || keys.some(key => !/^[a-f0-9-]{20,64}$/i.test(key))) {
    throw new Error("Manifest has no accounts or contains an invalid user key.");
  }
  const sqlValues = keys.map(key => `'${key.replace(/'/g, "''")}'`).join(",\n");
  const sql = `DELETE FROM account_sessions WHERE user_key IN (${sqlValues});\nDELETE FROM users WHERE user_key IN (${sqlValues});\n`;
  const output = resolve("backups", "stress-cleanup.sql");
  await mkdir("backups", { recursive: true });
  await writeFile(output, sql, { mode: 0o600 });
  console.log(`Created ${output} for ${keys.length} test accounts.`);
  console.log("Nothing has been deleted. Review the SQL, then run the separate Wrangler command.");
  process.exit(0);
}

if (!Number.isInteger(COUNT) || COUNT < 1 || COUNT > 500) throw new Error("STRESS_ACCOUNT_COUNT must be between 1 and 500.");
if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1 || CONCURRENCY > 20) throw new Error("STRESS_CONCURRENCY must be between 1 and 20.");

const batch = Date.now().toString(36).toUpperCase().slice(-7);
const startedAt = new Date().toISOString();
const candidates = Array.from({ length: COUNT }, (_, index) => ({
  username: `${PREFIX}${batch}${String(index + 1).padStart(3, "0")}`
}));

console.log(`Target: ${BASE_URL}`);
console.log(`Creating ${COUNT} identifiable test accounts with concurrency ${CONCURRENCY}.`);

const creationResults = await runPool(candidates, Math.min(CONCURRENCY, 5), async candidate => {
  const result = await request("/lb/register", {
    method: "POST",
    body: JSON.stringify({
      username: candidate.username,
      site: "qv",
      mastered: 0,
      xp: 0,
      mastered_ids: [],
      pending_ids: [],
      pending_data: []
    })
  });
  if (!result.success || !result.userKey) throw new Error("Registration response did not include success and userKey.");
  return { username: candidate.username, userKey: result.userKey };
});

const accounts = creationResults.filter(result => result.ok).map(result => result.value);
const creationFailures = creationResults
  .map((result, index) => ({ ...result, username: candidates[index].username }))
  .filter(result => !result.ok);

await mkdir("backups", { recursive: true });
const manifestPath = resolve("backups", `live-stress-${batch}.json`);
const manifest = {
  createdAt: startedAt,
  baseUrl: BASE_URL,
  requestedAccounts: COUNT,
  accounts,
  creationFailures: creationFailures.map(result => ({
    username: result.username,
    error: result.error
  }))
};
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });

console.log(`Created ${accounts.length}/${COUNT}. Manifest: ${manifestPath}`);

const reads = await runPool(accounts, CONCURRENCY, async account => {
  const result = await request("/lb/get?userKey=" + encodeURIComponent(account.userKey));
  if (!result.found || result.user?.username !== account.username) {
    throw new Error("Returned account data did not match the created account.");
  }
  return account.username;
});

const leaderboardChecks = await runPool(Array.from({ length: 5 }, (_, index) => index), Math.min(CONCURRENCY, 5), async () => {
  const result = await request("/lb/list");
  if (!Array.isArray(result.users)) throw new Error("Leaderboard response did not contain a users array.");
  const visible = new Set(result.users.map(user => user.username));
  const missing = accounts.filter(account => !visible.has(account.username));
  if (missing.length) throw new Error(`${missing.length} generated accounts missing from leaderboard.`);
  return result.users.length;
});

const readFailures = reads.filter(result => !result.ok);
const leaderboardFailures = leaderboardChecks.filter(result => !result.ok);
manifest.completedAt = new Date().toISOString();
manifest.results = {
  accountsCreated: accounts.length,
  creationFailures: creationFailures.length,
  accountReadChecks: reads.length,
  accountReadPassed: reads.length - readFailures.length,
  accountReadFailed: readFailures.length,
  leaderboardChecks: leaderboardChecks.length,
  leaderboardPassed: leaderboardChecks.length - leaderboardFailures.length,
  leaderboardFailed: leaderboardFailures.length,
  concurrency: CONCURRENCY
};
manifest.failures = [
  ...creationFailures.map(result => `${result.username}: ${result.error}`),
  ...readFailures.map(result => result.error),
  ...leaderboardFailures.map(result => result.error)
];
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });

console.log(JSON.stringify({ ...manifest.results, manifest: manifestPath }, null, 2));
if (manifest.failures.length) process.exitCode = 1;
