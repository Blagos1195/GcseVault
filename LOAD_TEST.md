# Live load test

This test makes read-only requests to the live GitHub Pages site and the production Worker. It does not create accounts, change progress, submit content, send notifications or call Workers AI.

It measures concurrent authenticated sessions, not the maximum number of account rows the database can store.

## Prepare test accounts

Create dedicated test accounts in GCSE Vault. Do not use real users' accounts.

For each test account, sign in on the live site, open the browser developer console and run:

```js
localStorage.getItem("vault_account_session")
```

Copy the returned 64-character token and the value of `localStorage.getItem("vault_userKey")` into `scripts/load-test-accounts.json`. Keep the file private. It contains active login sessions and account keys.

Copy `scripts/load-test-accounts.example.json` to `scripts/load-test-accounts.json`, then replace the example values with the test tokens. The real file is ignored by Git.

Do not paste session tokens into chat, commit them, or share them. Sign out of the test accounts when finished to revoke their sessions.

## Install and run

Install Grafana k6 using its official Windows installation instructions. From the repository root in the VS Code terminal, first run the normal regression tests:

```powershell
npm test
```

Set BASE_URL to the live site address shown in your browser, including the `/GcseVault` path. Then start with five concurrent test accounts:

```powershell
k6 run -e BASE_URL=https://your-live-site/GcseVault -e MAX_VUS=5 scripts/live-load.k6.js
```

The test ramps up gradually, holds the selected load, and then ramps down. Each virtual user uses a different test-account session. Each iteration requests one of the five live site pages and the authenticated account progress endpoint.

The initial script caps the test at 20 concurrent accounts. Run the levels separately, increasing only after reviewing the previous results:

```powershell
k6 run -e MAX_VUS=5 scripts/live-load.k6.js
k6 run -e BASE_URL=https://your-live-site/GcseVault -e MAX_VUS=10 scripts/live-load.k6.js
k6 run -e BASE_URL=https://your-live-site/GcseVault -e MAX_VUS=20 scripts/live-load.k6.js
```

You need at least the same number of distinct test-account sessions as the selected VU count. Stop immediately with Ctrl+C if the real site becomes slow or starts returning errors.

## Reading the results

Check the k6 summary for:

- `account_api_duration p(95)`: 95% of authenticated API requests should complete in under 1.5 seconds.
- `account_api_failure_rate`: should remain below 1%.
- `page_duration p(95)`: 95% of page requests should complete in under 1.5 seconds.
- `page_failure_rate`: should remain below 1%.

A failed threshold means that load level did not meet the target. It does not automatically mean the Worker is broken; inspect Cloudflare Worker metrics and D1 metrics at the same timestamps.

This is a controlled first-pass test, not a maximum-capacity or denial-of-service test. It deliberately avoids writes and AI generation. Account creation, login throughput, moderation writes and Revision sync writes need separate tests using an isolated staging database before they are measured.
