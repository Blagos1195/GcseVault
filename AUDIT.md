# GCSE Vault backend audit

## Data layout

| Data | Current deployed location | Branch target after migration |
|---|---|---|
| QuoteVault and DateVault account stats, XP, mastery IDs, streaks and moderation metadata | D1 `users` table | D1 `users` table |
| Revision accounts, sets and progress | D1 `revision_sync_data`, with legacy `REVISION` KV retained as a backup/mirror | D1 `revision_sync_data` |
| Revision leaderboard | `REVISION` KV namespace | D1 `revision_leaderboard`, with KV retained as a backup/mirror |
| Public and pending revision notes | `REVISION` KV namespace | `REVISION` KV namespace |
| Custom themes | `THEMES` KV namespace and browser local storage | D1 `custom_themes`, with KV retained as a backup/mirror |
| QuoteVault and DateVault submissions and published content | Existing KV namespaces | Existing KV namespaces |
| Local revision sets, progress and study preferences | Browser local storage | Browser local storage, with account-specific local snapshots |
| Local QuoteVault and DateVault practice progress | Browser local storage | Browser local storage |

## Changes in this branch

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
- An owner-controlled, paginated migration copies existing Revision and theme KV records into D1. It is repeatable and does not delete the source KV records.
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

## Important account security note

GCSE Vault's existing account system uses a private user key as a bearer credential rather than a conventional username-and-password login. Anyone who obtains that key can act as that account. Password accounts now add a salted password hash and require a valid account session for the account-key endpoints covered by the Worker guard. The internal account key remains a recovery credential during the transition, so keep it private. Historical versions exposed account keys through some public API responses, so old keys should not automatically be assumed uncompromised. Passwords are not stored in plaintext and cannot be viewed by administrators. This is not end-to-end encryption: the Worker and database can still access account data.

## Remaining work

1. **Password account rollout checks.** The code and UI flows are in place on this branch, but browser-level testing is still required across all three Vaults. Existing users must add a password using their current account key before they can use password login on another device.
2. **Live data backup and migration.** The repository connection cannot query the deployed Cloudflare D1 or KV resources. The new D1 migrations have not been applied to production, and no production data has been changed or migrated.
3. **Migration verification.** Export the live D1 database and relevant KV namespaces, record counts/checksums, apply the migrations, run the owner migration, and compare source and destination counts before relying on D1-only reads. Keep the KV copies until verification and cross-device testing are complete.
4. **Moderation consistency.** QuoteVault and DateVault approval/rejection still update KV and D1 in separate operations. Some D1 cleanup errors are non-fatal. These paths need idempotent retry handling and visible recovery for partial failures.
5. **End-to-end checks.** CI covers worker regressions and frontend syntax, but browser-level tests across QuoteVault, DateVault and Revision, especially offline and multi-device flows, are still required.
6. **Production rollout.** The draft pull request is not merged and the Worker is not deployed. Do not deploy the branch before applying all four D1 migrations.

## UI scope

The existing QuoteVault, DateVault and Revision content, theme system, navigation and study features are retained. The admin access screen changes to account-based access and owner-controlled roles. No production database or KV records have been modified.
