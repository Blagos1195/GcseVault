# GCSE Vault backend audit

## Current data layout

| Data | Current location |
|---|---|
| QuoteVault and DateVault account stats, XP, mastery IDs, streaks and moderation metadata | D1 `users` table |
| Revision accounts, sets, progress and revision leaderboard | `REVISION` KV namespace |
| Public and pending revision notes | `REVISION` KV namespace |
| Custom themes | `THEMES` KV namespace, with a browser local-storage copy |
| QuoteVault and DateVault submissions and published content | Their existing KV namespaces |
| Local revision sets, progress and study preferences | Browser local storage |
| Local QuoteVault and DateVault practice progress | Browser local storage |

This split is not automatically a design flaw. D1 is suited to structured account and leaderboard queries; KV currently stores larger revision documents and content. Moving everything into one database without measuring real record sizes and taking a live backup would add risk without proving a benefit.

## Changes in this branch

- Public leaderboard responses no longer include account keys.
- Username lookups return only whether a username exists and its public name, not the account key or private progress/submission data.
- Leaderboard registration validates the site identifier and numeric statistics before using them.
- QuoteVault rejection cleanup now selects the correct QuoteVault pending-ID column.
- QuoteVault withdrawals now fail closed when an account key is supplied but the ownership record cannot be verified; users without a linked account retain the existing submission-ID withdrawal path. DateVault withdrawals require an account key and verify that the pending submission belongs to it. Database verification errors fail closed.
- Custom theme keys reject separators rather than silently validating a transformed version of the key.
- Added worker regression tests and a GitHub Actions test workflow.
- Removed the local Wrangler account cache from the current tree and added ignore rules for Wrangler and environment files.

## Remaining work

1. **Live data inventory and backup.** The repository connection can inspect source code but cannot query or export the deployed Cloudflare D1 and KV resources. No production data has been changed or migrated.
2. **Revision sync conflict handling.** Revision edits are saved locally and asynchronously sent to KV. On load, remote data currently replaces local state when a remote record exists. Offline local edits can therefore be overwritten by an older remote copy. A versioned merge or conflict-resolution design is needed before changing storage.
3. **Account-key rotation.** Account keys previously appeared in public API responses. They are no longer exposed by the current public endpoints, but historical copies may have been cached or scraped. A safe rotation/recovery mechanism should be designed before treating all existing keys as uncompromised.
4. **Moderation consistency.** QuoteVault and DateVault approval/rejection currently update KV and D1 in separate operations, with some D1 cleanup failures swallowed. These paths need idempotent retry handling so partial failures are visible and recoverable.
5. **End-to-end checks.** The worker tests cover the regressions fixed here. Browser-level tests across QuoteVault, DateVault and Revision, including multi-device and offline flows, are still needed.

## Database migration decision

No database bindings or production data stores were changed in this branch. A D1 migration should only proceed after:

- exporting the live D1 tables and every relevant KV namespace;
- recording counts and checksums for the exported records;
- confirming a target schema that handles large revision sets without exceeding D1 row limits;
- running an idempotent backfill and verifying every source record against its destination;
- switching reads only after verification, while retaining the old KV data for rollback.

The existing UI, themes, revision content and user-facing features are intentionally unchanged.
