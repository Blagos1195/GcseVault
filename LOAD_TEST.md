# Live load test

The test suite has two parts:

- A Playwright browser pass that opens all five live site pages, downloads their assets and runs their JavaScript.
- A k6 API pass that measures concurrent authenticated account requests.

Both use dedicated test accounts. Do not use real users' accounts.

## Prepare test accounts

Create dedicated test accounts in GCSE Vault. For each account, sign in on the live site, open the browser developer console and run:

```js
localStorage.getItem("vault_account_session")
localStorage.getItem("vault_userKey")
```

Copy both values into `scripts/load-test-accounts.json`. The session must be a 64-character token. Keep this file private: it contains active login sessions and account keys.

Copy `scripts/load-test-accounts.example.json` to `scripts/load-test-accounts.json`, then replace the example values. The real file is ignored by Git.

Do not paste these values into chat, commit them or share them. Sign out of the test accounts when finished to revoke their sessions.

Set the live site URL shown in your browser, including the `/GcseVault` path. For example:

```powershell
$env:BASE_URL = "https://your-live-site/GcseVault"
```

## 1. Full browser pass

From the repository root in the VS Code terminal, install Playwright and Chromium:

```powershell
npm install --no-save --package-lock=false playwright
npx playwright install chromium
```

Start with three concurrent test accounts:

```powershell
$env:MAX_ACCOUNTS = "3"
node scripts/live-browser-load.mjs
```

Then repeat with five and ten accounts only if the site and your computer remain responsive:

```powershell
$env:MAX_ACCOUNTS = "5"
node scripts/live-browser-load.mjs
$env:MAX_ACCOUNTS = "10"
node scripts/live-browser-load.mjs
```

Each browser context visits the root dashboard, QuoteVault, DateVault, Revision and the progress dashboard. The script records page-load times, JavaScript errors, failed first-party requests and HTTP errors. It suppresses automatic feedback submissions so a failed resource does not create test bug reports or admin notifications.

The browser pass is capped at ten accounts because each virtual user runs a real browser.

## 2. API concurrency pass

Install Grafana k6 using its official Windows installation instructions. First run the normal regression suite:

```powershell
npm test
```

Start with five concurrent authenticated accounts:

```powershell
k6 run -e BASE_URL=https://your-live-site/GcseVault -e MAX_VUS=5 scripts/live-load.k6.js
```

The k6 test ramps up gradually, holds the selected load, then ramps down. Each virtual user uses a different test-account session. Each iteration requests one of the five site pages and the authenticated account progress endpoint.

The initial script caps the test at 20 concurrent accounts. Increase in separate runs, reviewing each result before moving on:

```powershell
k6 run -e BASE_URL=https://your-live-site/GcseVault -e MAX_VUS=10 scripts/live-load.k6.js
k6 run -e BASE_URL=https://your-live-site/GcseVault -e MAX_VUS=20 scripts/live-load.k6.js
```

You need at least the same number of distinct test-account sessions as the selected VU count. Stop immediately with Ctrl+C if the real site becomes slow or starts returning errors.

## Reading the results

For k6, check:

- `account_api_duration p(95)`: 95% of authenticated API requests should complete in under 1.5 seconds.
- `account_api_failure_rate`: should remain below 1%.
- `page_duration p(95)`: 95% of page requests should complete in under 1.5 seconds.
- `page_failure_rate`: should remain below 1%.

For Playwright, check the page-load p95 and the `failures` array.

A failed threshold means that load level did not meet the target. It does not automatically mean the Worker is broken; compare the test timestamps with Cloudflare Worker and D1 metrics.

These are controlled first-pass tests, not denial-of-service tests. They avoid AI generation and content submissions. Account creation, login throughput, moderation writes and Revision sync writes need separate tests using an isolated staging database.
