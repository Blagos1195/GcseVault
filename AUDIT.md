# GCSE Vault backend audit

## Data layout

| Data | Current deployed location | Branch target after migration |
|---|---|---|
| QuoteVault and DateVault account stats, XP, mastery IDs, streaks and moderation metadata | D1 `users` table | D1 `users` table |
| Revision accounts, sets, progress and revision leaderboard | `REVISION` KV namespace | D1 `revision_sync_data`, with KV retained as a backup/mirror |
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
- Revision local snapshots are kept separately per account when switching accounts, so one linked account does not silently replace another account's local workspace.
- Custom themes use D1 as the primary store. KV remains a backup/mirror and is imported when needed.
- An owner-controlled, paginated migration copies existing Revision and theme KV records into D1. It is repeatable and does not delete the source KV records.
- Admin access uses account roles: one owner can grant or remove admin access. Admins can moderate but cannot manage roles.
- Admin sessions use random tokens in request headers, expire after eight hours, and are checked against the current account role on each request. The old shared-password admin login and token-in-query/body paths have been removed. The existing `ADMIN_KEY` is used only for initial owner setup. A permanent D1 setup lock is claimed atomically with the first owner promotion, preventing reuse for another account even if roles are later altered.
- Added worker regression tests, frontend JavaScript syntax checks, and a GitHub Actions test workflow.
- Added an additive password-account schema for credential hashes, hashed sessions and encrypted Revision payloads.
- Added browser AES-256-GCM primitives using a random encryption key independent of the login password, wrapped by a separate 256-bit recovery key. Encryption round-trip, recovery and tamper checks are covered by CI.
- Added `SECURITY_DESIGN.md` with the target threat model and a staged, per-account data migration plan. These foundations are not yet connected to registration, login or Revision sync.
- Removed the local Wrangler account cache from the branch and added ignore rules for Wrangler and environment files.

## Important account security note

GCSE Vault's existing account system uses a private user key as a bearer credential rather than a conventional username-and-password login. Anyone who obtains that key can act as that account. The admin panel exchanges the linked account key for a short-lived admin session; it does not turn the existing account system into password-based authentication. Keep account keys private. Historical versions exposed account keys through some public API responses, so old keys should not automatically be assumed uncompromised.

## Remaining work

1. **Password account implementation.** The current bearer-key login remains active. Password registration/login, password hashing, account-session enforcement across all private endpoints, recovery flows and frontend integration are not implemented. The new schema and browser encryption helper are foundations only.
2. **Live data backup and migration.** The repository connection cannot query the deployed Cloudflare D1 or KV resources. The new D1 migrations have not been applied to production, and no production data has been changed or migrated.
2. **Migration verification.** Export the live D1 database and relevant KV namespaces, record counts/checksums, apply the migrations, run the owner migration, and compare source and destination counts before relying on D1-only reads. Keep the KV copies until verification and cross-device testing are complete.
3. **Moderation consistency.** QuoteVault and DateVault approval/rejection still update KV and D1 in separate operations. Some D1 cleanup errors are non-fatal. These paths need idempotent retry handling and visible recovery for partial failures.
4. **End-to-end checks.** CI covers worker regressions and frontend syntax, but browser-level tests across QuoteVault, DateVault and Revision, especially offline and multi-device flows, are still required.
5. **Production rollout.** The draft pull request is not merged and the Worker is not deployed. Do not deploy the branch before applying both D1 migrations.

## UI scope

The existing QuoteVault, DateVault and Revision content, theme system, navigation and study features are retained. The admin access screen changes to account-based access and owner-controlled roles. No production database or KV records have been modified.
