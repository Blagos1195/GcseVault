# GCSE Vault

GCSE Vault is a static GCSE revision site backed by a Cloudflare Worker. It brings together QuoteVault for English Literature, DateVault for History and Revision for flashcards, course materials, study planning and exam practice.

## Site structure

| Path | Purpose |
|---|---|
| `index.html` | Main site landing page |
| `quotes/` | QuoteVault: English Literature revision |
| `dates/` | DateVault: History revision |
| `revision/` | Revision workspace, flashcards, course materials and exam practice |
| `progress/` | Account progress dashboard |
| `admin/` | Account-based administration and moderation |
| `feedback/` | Feedback and submission interface |
| `shared.js` | Shared account, theme and site utilities |
| `worker.js` | Cloudflare Worker API |
| `wrangler.toml` | Worker name, entry point and Cloudflare bindings |
| `migrations/` | D1 database migrations |
| `tests/` | Automated regression, syntax and browser tests |

Each main study area keeps its page structure, stylesheet and application code separate:

- QuoteVault: `quotes/index.html`, `quotes/quotes.css`, `quotes/quotes.js`
- DateVault: `dates/index.html`, `dates/dates.css`, `dates/dates.js`
- Revision: `revision/index.html`, `revision/revision.css`, `revision/app.js`, `revision/practice.js`

Revision course catalogues and importable course packs are in `revision/catalogues/` and `revision/course-packs/`. Revision includes multiple revision sets, a daily plan, topic health, content search, resource review tracking, exam-practice history and JSON backups. Account progress syncs across devices.

## Architecture

- **Cloudflare Pages** serves the static website.
- **Cloudflare Workers** runs the API in `worker.js`. The deployed Worker is named `quotevault-api`.
- **D1** stores account, session, synced progress and other relational data. The configured database is `leaderboard`.
- **Workers KV** stores the remaining content, pending submissions, themes and other key-value data. The seven namespaces and their IDs are declared in `wrangler.toml`.
- **Workers AI** is bound as `AI` for the authorised Revision study-guide generator.
- **Web Push** sends admin submission notifications.

The Worker expects the bindings declared in `wrangler.toml`. Do not create replacement databases or KV namespaces just to deploy it: the configured IDs point to the existing production resources.

## Local development and tests

Requirements: Node.js 22 or later.

Run the automated test suite:

```sh
npm test
```

The GitHub Actions test workflow also installs Playwright and Chromium and runs the browser regression suite:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install --with-deps chromium
node tests/browser.e2e.mjs
```

The static site has no frontend build step. Keep browser code in the page-specific JavaScript files, shared cross-site behaviour in `shared.js`, and backend endpoints in `worker.js`.

## Deploying the site

The static site is deployed separately from the Worker through the existing Cloudflare Pages project connected to this repository. A successful Pages deployment does **not** mean the Worker has deployed.

Keep the Pages project pointed at the repository's existing production branch and static-site root. No framework build is required; leave the build command empty unless the Pages project has a project-specific requirement.

## Deploying the Worker

The Worker is configured by the root-level `wrangler.toml`. Deploy from the repository root, where both `wrangler.toml` and `worker.js` are present.

Using the Cloudflare dashboard's Git integration, check the Worker build settings:

- Root directory: repository root (`/`).
- Build command: leave empty; this project does not need a compile/build step.
- Deploy command: `npx wrangler deploy`.
- The deployment must use the root `wrangler.toml`, not a Pages-only build configuration.

For a local deployment, use Wrangler from the repository root:

```sh
npx wrangler whoami
npx wrangler deploy --dry-run
npx wrangler deploy
```

The dry run validates the Worker bundle and configuration without publishing it. The final command publishes to the Worker named in `wrangler.toml`.

If a deployment fails, capture the **complete build/deploy output**, including the first error above the final failure summary. A generic "deployment failed" status is not enough to identify whether the problem is the root directory, Wrangler configuration, missing binding, authentication or an actual Worker bundle error. GitHub Pages and the test workflow do not contain Cloudflare Worker deployment logs.

### Worker secrets and variables

The public VAPID key and contact subject are configured as non-secret variables in `wrangler.toml`. The matching private VAPID key must be stored as a Worker secret and must never be committed:

```sh
npx wrangler secret put VAPID_PRIVATE_KEY
```

Paste the private key only into Wrangler's secure prompt. Do not put it in this README, source code, GitHub files or chat.

The Worker uses the bindings declared in `wrangler.toml`: D1 binding `DB`, KV bindings `DV_PENDING`, `DV_PUBLIC`, `FEEDBACK`, `PUBLIC_QUOTES`, `QUOTEVAULT`, `THEMES` and `REVISION`, plus the Workers AI binding `AI`. If Cloudflare reports a missing binding, compare the deployed Worker configuration with this file rather than creating a new resource.

### D1 migrations

Migration files live in `migrations/` and are configured through the `DB` binding's `migrations_dir`. The production database has already been migrated through the migrations currently in this repository. Do not rerun old SQL manually or create a second database.

To inspect migration status:

```sh
npx wrangler d1 migrations list leaderboard --remote
```

Only apply a migration when a new migration file has intentionally been added and the remote list confirms it is pending. Back up production data before any schema or data migration.

## Admin push notifications

Admins enable browser notifications separately on each browser/device from the admin workspace. Push subscriptions are stored per admin account in D1 and removed automatically when a push service reports an expired subscription. The public key in `admin/admin.js` must match `VAPID_PUBLIC_KEY` in `wrangler.toml`; the corresponding private key is the `VAPID_PRIVATE_KEY` Worker secret.

## Security and operational notes

- Never commit `.dev.vars`, private keys, account credentials, database exports or KV backups.
- Keep production D1 and KV backups private.
- Admin and AI access are account/session based; do not reintroduce shared admin passwords or expose account keys in public responses.
- See [SECURITY_DESIGN.md](SECURITY_DESIGN.md), [SECURITY_REVIEW.md](SECURITY_REVIEW.md) and [CLOUDFLARE_MIGRATION.md](CLOUDFLARE_MIGRATION.md) for the deeper security and operational design.
