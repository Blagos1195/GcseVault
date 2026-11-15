import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const workerUrl = (process.env.GCSE_VAULT_WORKER_URL || "https://quotevault-api.noah-l-barker.workers.dev").replace(/\/$/, "");
const stages = [25, 50, 100, 200, 400, 800];
const maxAccounts = Math.max(1, Math.min(1575, Number(process.env.STRESS_MAX_ACCOUNTS) || 1575));
const stopErrorRate = 0.05;
const stopP95Ms = 5000;
const runId = randomBytes(4).toString("hex");
const prefix = "zt" + runId;
const created = [];
let attempted = 0;
const results = [];

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]);
}

async function request(path, options = {}) {
  const started = performance.now();
  try {
    const response = await fetch(workerUrl + path, {
      ...options,
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const body = await response.text();
    let data = null;
    try { data = JSON.parse(body); } catch {}
    return { ok: response.ok, status: response.status, ms: performance.now() - started, data, body };
  } catch (error) {
    return { ok: false, status: 0, ms: performance.now() - started, error: error.message };
  }
}

async function runPool(items, concurrency, task) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await task(items[index], index);
    }
  });
  await Promise.all(workers);
}

function report(label, batch) {
  const times = batch.map(item => item.ms);
  const failures = batch.filter(item => !item.ok).length;
  const summary = {
    label,
    requests: batch.length,
    passed: batch.length - failures,
    failed: failures,
    p50_ms: percentile(times, 0.5),
    p95_ms: percentile(times, 0.95),
    max_ms: Math.round(Math.max(0, ...times))
  };
  results.push(summary);
  console.log(JSON.stringify(summary));
  return summary;
}

function cleanup() {
  if (!attempted) return true;
  const sql = "DELETE FROM users WHERE substr(username, 1, " + prefix.length + ") = '" + prefix + "'";
  console.log("Removing " + created.length + " disposable accounts from the live D1 database...");
  const result = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["wrangler", "d1", "execute", "leaderboard", "--remote", "--command", sql], {
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status === 0;
}

async function main() {
  console.log("Live GCSE Vault stress test");
  console.log("Worker: " + workerUrl);
  console.log("Disposable username prefix: " + prefix);
  console.log("Maximum accounts: " + maxAccounts);
  console.log("Stages create real users rows in production D1. No existing account is modified.");

  const baseline = await request("/lb/list");
  if (!baseline.ok) throw new Error("Live leaderboard baseline failed: HTTP " + baseline.status + " " + (baseline.body || baseline.error || ""));

  let remaining = maxAccounts;
  let stageNumber = 0;
  for (const planned of stages) {
    if (!remaining) break;
    const count = Math.min(planned, remaining);
    const concurrency = Math.min(30, 5 + stageNumber * 5);
    const batch = [];
    const accounts = Array.from({ length: count }, (_, i) => ({
      username: prefix + String(created.length + i).padStart(5, "0"),
      site: "qv",
      mastered: 0,
      xp: 0,
      mastered_ids: [],
      pending_ids: [],
      pending_data: []
    }));

    await runPool(accounts, concurrency, async account => {
      attempted++;
      const result = await request("/lb/register", { method: "POST", body: JSON.stringify(account) });
      batch.push(result);
      if (result.ok && result.data?.success && result.data?.userKey) created.push(account.username);
      else result.ok = false;
    });

    const summary = report("create-stage-" + (++stageNumber) + "-concurrency-" + concurrency, batch);
    remaining -= count;
    if (summary.failed / summary.requests >= stopErrorRate || summary.p95_ms > stopP95Ms) {
      console.log("Stopping the ramp: failure rate or latency threshold reached.");
      break;
    }
  }

  const lookupBatch = [];
  await runPool(created, 20, async username => {
    const result = await request("/lb/get?username=" + encodeURIComponent(username));
    result.ok = result.ok && result.data?.found === true;
    lookupBatch.push(result);
  });
  report("account-lookups", lookupBatch);

  const leaderboardBatch = [];
  await runPool(Array.from({ length: 20 }, () => 1), 10, async () => {
    leaderboardBatch.push(await request("/lb/list"));
  });
  report("leaderboard-reads", leaderboardBatch);
}

let interrupted = false;
process.once("SIGINT", () => {
  interrupted = true;
  console.log("\nInterrupt received. Finishing cleanup after current requests...");
});

try {
  await main();
} catch (error) {
  console.error("Stress test error: " + error.message);
} finally {
  const cleaned = cleanup();
  console.log("\nRESULT");
  console.log(JSON.stringify({
    prefix,
    accountsCreated: created.length,
    accountsAttempted: attempted,
    stages: results,
    cleanupSucceeded: cleaned,
    interrupted
  }, null, 2));
  if (!cleaned) {
    console.error("CLEANUP FAILED. Run this in the repo terminal:");
    console.error("npx wrangler d1 execute leaderboard --remote --command \"DELETE FROM users WHERE substr(username, 1, " + prefix.length + ") = '" + prefix + "'\"");
    process.exitCode = 1;
  }
}
