# GCSE Vault backend audit

## Intended data layout

The repository targets this layout. The owner has applied all five tracked D1 migrations and deployed the current Worker. The owner-controlled KV-to-D1 data copy is complete. First-owner setup is complete and the `ADMIN_KEY` secret has been removed. Browser verification is still pending.

| Data | Intended primary store | Legacy or local copy |
|---|---|---|
| QuoteVault and DateVault account stats, XP, mastery IDs, streaks and moderation metadata | D1 `users` table | Existing KV content remains in its current namespaces |
| Revision accounts, sets and progress | D1 `revision_sync_data` | `REVISION` KV retained as a backup/mirror |
| Revision leaderboard | D1 `revision_leaderboard` | `REVISION` KV retained as a backup/mirror |
| Public and pending revision notes | `REVISION` KV | No D1 migration planned |
| Custom themes | D1 `custom_themes` | `THEMES` KV retained as a backup/mirror |
| QuoteVault and DateVault submissions and published content | Existing KV namespaces | No blanket migration planned |
| Local revision sets, progress and study preferences | Browser local storage | Account-specific local snapshots |
| Local QuoteVault and DateVault practice progress | Browser local storage | Browser local storage |

## Changes in the code

- Public leaderboard and username lookup responses no longer disclose account keys or private account records.
- New account keys are generated with cryptographically secure UUIDs.
- Leaderboard registration validates the site identifier and numeric statistics.
- QuoteVault rejection cleanup uses the correct QuoteVault pending-ID fields.
- QuoteVault and DateVault withdrawals require an account key and verify that the submission belongs to that account.
- Custom theme keys are validated and account ownership is checked before theme access.
- Revision sync uses D1 with optimistic concurrency checks. Conflicts preserve the local copy and provide a choice to keep local or load remote data.
- Revision leaderboard reads and writes use D1 `revision_leaderboard`; an owner-controlled migration copies existing KV leaderboard records into D1 without deleting the KV backups.
- Revision local snapshots are kept separately per account when switching accounts, so one linked account does not silently replace another account's local workspace.
- Custom themes use D1 as the primary store. KV remains a backup/mirror and is imported when needed.
- An owner-controlled, paginated migration copies existing Revision and theme KV records into D1. It is repeatable and does not delete the source KV records. Migration reporting distinguishes newly copied, already-present and skipped records.
- Admin access uses account roles: one owner can grant or remove admin access. Admins can moderate but cannot manage roles.
- Admin sessions use random tokens in request headers, expire after eight hours, and are checked against the current account role on each request. The old shared-password admin login and token-in-query/body paths have been removed. The existing `ADMIN_KEY` is used only for initial owner setup. A permanent D1 setup lock is claimed atomically with the first owner promotion, preventing reuse for another account even if roles are later altered.
- Added worker regression tests, frontend JavaScript syntax checks, and a GitHub Actions test workflow.
- Added password account credentials using PBKDF2-HMAC-SHA-256 with 600,000 iterations and a unique random salt per account.
- Added random 256-bit account sessions stored as SHA-256 hashes in D1, with a 30-day expiry and login throttling.
- Added account setup, password login, session validation, logout and account-key recovery/reset endpoints.
- Added account-session checks to the key-based endpoints used for leaderboard updates, theme sync, Revision sync, submissions and withdrawals. Legacy accounts without a password remain compatible during migration.
- Added password login/setup controls to the existing account panels in QuoteVault, DateVault and Revision. The shared fetch wrapper attaches the account session to Worker requests.
- Added tests for password hashing, login, session validation and rejection of unauthenticated access to a password-protected account.
- `SECURITY_DESIGN.md` and `CLOUDFLARE_MIGRATION.md` document the conventional password model, recovery limitations and staged rollout.
- Removed the local Wrangler account cache from the branch and added ignore rules for Wrangler and environment files.
- Moderation updates now write D1 account metadata before deleting pending KV records. This makes approval/rejection safer to retry after partial failures.

## Important account security note

GCSE Vault's existing account system uses a private user key as a bearer credential rather than a conventional username-and-password login. Anyone who obtains that key can act as that account. Password accounts add a salted password hash and require a valid account session for the account-key endpoints covered by the Worker guard. The internal account key remains a recovery credential during the transition, so keep it private. Historical versions exposed account keys through some public API responses, so old keys should not automatically be assumed uncompromised. Passwords are not stored in plaintext and cannot be viewed by administrators. This is not end-to-end encryption: the Worker and database can still access account data.

## Production rollout status

The owner reports the following successful production steps:
- Applied `0005_revision_leaderboard.sql` to the remote `leaderboard` D1 database. Wrangler reported all three SQL statements executed and marked the migration successful.
- Re-ran `npx wrangler d1 migrations list leaderboard --remote`; Wrangler returned `No migrations to apply!`.
- Deployed the Worker successfully to `https://quotevault-api.noah-l-barker.workers.dev` (version `fb9b7e72-07c9-44c0-a8e0-4d19ec2c7b8e`).

These outputs were supplied by the owner; the repository connection cannot independently inspect Cloudflare's live database or deployment.

Production backups have now been created and locally checked by the owner:
- D1 export: `leaderboard-backup.sql` downloaded successfully (38,033 bytes).
- `REVISION` KV: the key listing returned five keys; the bulk export is valid JSON and contains five string-valued entries.
- `THEMES` KV: the key listing returned an empty array, so there were no values to export.
- These backup files are untracked local files and must not be committed or uploaded publicly.

## Production data migration status

The owner completed first-owner setup, removed the `ADMIN_KEY` Worker secret, and ran **Migrate existing storage to D1**. The Admin Panel reported: `Migration complete: 3 copied, 1 already present, 0 skipped. Original KV copies remain available.` This is consistent with the four private Revision sync/leaderboard records being processed; the public Revision record remains in KV by design, and the `THEMES` namespace was empty. KV source records and local backups are being retained pending browser and cross-device verification.

## Remaining work

1. **Live endpoint and browser verification.** Check Worker health and test QuoteVault, DateVault and Revision flows. For Revision, verify sync, leaderboard updates, account switching and cross-device persistence. Keep all KV records and local backups until these checks pass.
2. **Password account rollout checks.** Browser-level testing is still required across all three Vaults. Existing users must add a password using their current account key before they can use password login on another device.
3. **Moderation consistency.** Regression tests cover D1 failures and retry-safe ordering. Browser-level verification and monitoring are still required.
4. **End-to-end checks.** CI covers Worker regressions and frontend JavaScript syntax, not full browser behaviour. Test QuoteVault, DateVault and Revision, especially offline, account switching and multi-device flows.

## Latest repository verification

- Latest repository commit: `987aaa8dca24d9c923781c0c91fe3015c32658df` (documentation-only).
- GitHub Actions test run `42670357089` completed successfully for application commit `b3ef0719de65bc6829cca465d5ece28c237a1661`; the commits after it only update documentation.
- The Pages run `42670356117` was cancelled. The most recent successful Pages deployment remains run `42669345186`, which deployed the unchanged application code from `74d31db2660171ebfb80f6dedaf2b4816390d632`.
- The Worker deployment and D1/KV migration are owner-confirmed. Browser behaviour and cross-device persistence remain unverified.

## UI scope

The existing QuoteVault, DateVault and Revision content, theme system, navigation and study features are retained. The admin access screen changes to account-based access and owner-controlled roles. No production D1 or KV records have been modified by the repository work.
