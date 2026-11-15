import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const baseUrl = String(process.env.BASE_URL || "").replace(/\/$/, "");
const maxAccounts = Math.min(10, Math.max(1, Math.floor(Number(process.env.MAX_ACCOUNTS || 3))));
const workerUrl = "https://quotevault-api.noah-l-barker.workers.dev";
const paths = ["/", "/quotes/", "/dates/", "/revision/", "/progress/"];

if (!baseUrl.startsWith("https://")) throw new Error("Set BASE_URL to the live site URL, including its /GcseVault path.");

const accounts = JSON.parse(await readFile(new URL("./load-test-accounts.json", import.meta.url), "utf8"));
if (!Array.isArray(accounts) || accounts.length < maxAccounts) {
  throw new Error("Add at least " + maxAccounts + " dedicated test-account sessions to scripts/load-test-accounts.json.");
}
for (let index = 0; index < maxAccounts; index++) {
  if (!/^[a-f0-9]{64}$/i.test(String(accounts[index]?.session || "")) || !String(accounts[index]?.userKey || "").trim()) {
    throw new Error("Test account " + (index + 1) + " does not contain a valid 64-character account session.");
  }
}

const browser = await chromium.launch({ headless: true });
const failures = [];
const timings = [];
const startedAt = Date.now();

try {
  await Promise.all(accounts.slice(0, maxAccounts).map(async (account, index) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(({ session, userKey }) => {
      localStorage.setItem("vault_account_session", session);
      localStorage.setItem("vault_userKey", userKey);
    }, { session: account.session, userKey: account.userKey });
    const page = await context.newPage();
    await page.route(workerUrl + "/feedback/submit", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, id: "load-test" }) }));
    page.on("pageerror", error => failures.push({ account: index + 1, type: "pageerror", message: error.message }));
    page.on("requestfailed", request => {
      const url = request.url();
      if (url.startsWith(baseUrl) || url.startsWith(workerUrl)) {
        failures.push({ account: index + 1, type: "requestfailed", url, error: request.failure()?.errorText || "Request failed" });
      }
    });
    page.on("response", response => {
      const url = response.url();
      if (response.status() >= 400 && (url.startsWith(baseUrl) || url.startsWith(workerUrl))) {
        failures.push({ account: index + 1, type: "http", status: response.status(), url });
      }
    });

    try {
      for (const path of paths) {
        const started = Date.now();
        const response = await page.goto(baseUrl + path, { waitUntil: "domcontentloaded", timeout: 30000 });
        const duration = Date.now() - started;
        timings.push(duration);
        if (!response || response.status() !== 200) {
          failures.push({ account: index + 1, type: "page", path, status: response?.status() || 0 });
        }
        const text = (await page.locator("body").innerText()).trim();
        if (!text) failures.push({ account: index + 1, type: "empty-page", path });
        await page.waitForTimeout(300);
      }
    } catch (error) {
      failures.push({ account: index + 1, type: "navigation", message: error.message });
    } finally {
      await context.close();
    }
  });
} finally {
  await browser.close();
}

timings.sort((a, b) => a - b);
const percentile95 = timings.length ? timings[Math.min(timings.length - 1, Math.ceil(timings.length * 0.95) - 1)] : 0;
const result = {
  accounts: maxAccounts,
  pagesPerAccount: paths.length,
  pageLoads: timings.length,
  durationMs: Date.now() - startedAt,
  averagePageLoadMs: timings.length ? Math.round(timings.reduce((sum, value) => sum + value, 0) / timings.length) : 0,
  p95PageLoadMs: percentile95,
  failures
};
console.log(JSON.stringify(result, null, 2));
if (failures.length || percentile95 > 5000) process.exitCode = 1;
