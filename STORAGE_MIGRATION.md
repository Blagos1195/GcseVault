# Cloudflare storage consolidation rollout

This change is deliberately staged. Do not delete KV namespaces or legacy D1 tables during the first deployment.

## Stage 1: create the consolidated D1 structures

The existing D1 and KV backups must remain available.

From the repository root in the VS Code terminal:

```powershell
npx wrangler d1 migrations apply leaderboard --remote
npx wrangler deploy
```

Migration 0008 is additive: it copies existing relational data into the consolidated tables and adds the new account columns, but it does not drop the old tables. This lets the existing Worker continue operating until the new Worker is deployed.

## Stage 2: copy KV data

Sign in to the owner Admin Panel and run the storage migration action once. It now copies every key from all seven KV namespaces into D1, preserving expiration and metadata. It is safe to run again.

Do not continue if the report shows unavailable namespaces or conflicts. A successful report should list all seven namespaces and show zero conflicts. Revision personal-sync and leaderboard keys are skipped only when their data matches the corresponding D1 user record exactly.

## Stage 3: switch reads and writes to D1

After the copy succeeds, change this line in `wrangler.toml`:

```toml
STORAGE_MODE = "kv"
```

to:

```toml
STORAGE_MODE = "d1"
```

Deploy again:

```powershell
npx wrangler deploy
```

The existing KV bindings are intentionally left configured for this verification period, but the Worker will use D1 for all storage operations.

Check account login, admin login, notifications, QuoteVault submissions/moderation, DateVault submissions/moderation, Revision sync/publication, themes, feedback and rate limits. Do not delete the KV namespaces yet.

## Stage 4: remove the legacy storage

Only after Stage 3 has been verified, run the read-only parity checks in `maintenance/storage-preflight.sql`:

```powershell
npx wrangler d1 execute leaderboard --remote --file maintenance/storage-preflight.sql
```

Every mismatch count must be zero. Then run `maintenance/storage-drop-legacy.sql` to remove the eleven superseded D1 tables. A separate configuration change will remove the seven KV bindings. Then the old KV namespaces can be deleted in Cloudflare.

The old D1 tables are deliberately retained by migration 0008 so the first deployment cannot destroy the current Worker’s data sources. The cleanup migration must be applied only after the D1-backed Worker is confirmed live.

## Useful verification queries

```sql
SELECT namespace, COUNT(*) AS records, SUM(length(value)) AS value_bytes
FROM kv_store
GROUP BY namespace
ORDER BY namespace;

SELECT kind, COUNT(*) AS records
FROM notifications
GROUP BY kind;

SELECT event_type, COUNT(*) AS records
FROM audit_log
GROUP BY event_type;

SELECT COUNT(*) AS password_accounts
FROM users
WHERE password_hash IS NOT NULL;

SELECT COUNT(*) AS revision_accounts
FROM users
WHERE revision_data_json IS NOT NULL;

SELECT name
FROM sqlite_master
WHERE type = 'table'
ORDER BY name;
```

## Automatic retention

The Worker runs a daily cleanup at 03:00 UTC. It removes expired D1-backed KV entries, feedback older than 90 days, admin notifications older than 90 days, acknowledged submission notifications older than 180 days, and test history older than 90 days. Unacknowledged submission notifications and moderation/account audit records are retained.
