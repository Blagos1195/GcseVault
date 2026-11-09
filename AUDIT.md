# GCSE Vault backend audit

## Intended data layout

The repository now targets this layout. Production rollout is incomplete, so this table describes the code's intended storage rather than independently verified live state.

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

The owner reports that `npx wrangler d1 migrations list leaderboard --remote` returned `No migrations to apply!`. This indicates Wrangler considers all five tracked migrations applied in the remote database. The repository connection cannot independently inspect Cloudflare's live migration history or database contents.

Production backups have now been created and locally checked by the owner:
- D1 export: `leaderboard-backup.sql` downloaded successfully (38,033 bytes).
- `REVISION` KV: the key listing returned five keys; the bulk export is valid JSON and contains five string-valued entries.
- `THEMES` KV: the key listing returned an empty array, so there were no values to export.
- These backup files are untracked local files and must not be committed or uploaded publicly.

## Remaining work

1. **Worker deployment.** The latest Worker code has not been confirmed deployed. Deploy it only after confirming the D1 export and remote migration history remain available.
2. **Owner setup and storage migration.** After deploying the Worker, complete first-owner setup, remove the `ADMIN_KEY` secret after successful setup, then run the owner-controlled storage migration. Compare scanned, migrated, already-present and skipped counts with the five original `REVISION` keys. The empty `THEMES` namespace should require no theme imports.
3. **Password account rollout checks.** Browser-level testing is still required across all three Vaults. Existing users must add a password using their current account key before they can use password login on another device.
4. **Moderation consistency.** Regression tests cover D1 failures and retry-safe ordering. Browser-level verification and monitoring are still required.
5. **End-to-end checks.** CI covers Worker regressions and frontend JavaScript syntax, not full browser behaviour. Test QuoteVault, DateVault and Revision, especially offline, account switching and multi-device flows.

## Latest repository verification

- Latest repository commit: `74d31db2660171ebfb80f6dedaf2b4816390d632`.
- GitHub Actions test run `42669345855` for that exact commit: successful.
- GitHub Pages build and deployment run `42667329513`: successful for application commit `d6c996e735f7a49171ae1be2c2bd3345c8067764`. The later `e7b91a1` and `74d31db` commits only changed migration and audit documentation; the application code deployed by the Pages run is unchanged.
- These results verify repository tests and the Pages deployment only. They do not verify the Cloudflare Worker deployment or owner-controlled production data migration.

## UI scope

The existing QuoteVault, DateVault and Revision content, theme system, navigation and study features are retained. The admin access screen changes to account-based access and owner-controlled roles. No production D1 or KV records have been modified by the repository work.
