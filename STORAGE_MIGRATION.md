# Cloudflare storage consolidation rollout

This rollout moves the seven KV namespaces into D1, consolidates the relational tables, and leaves six permanent application tables:

- `users`
- `account_sessions`
- `admin_push_subscriptions`
- `notifications`
- `audit_log`
- `kv_store`

Do not delete KV namespaces or legacy D1 tables until the D1-backed Worker has been deployed and verified. Keep the existing D1 and KV backups private and available throughout the rollout.

## Stage 1: create the consolidated D1 structures

From the repository root in the VS Code terminal:

```powershell
npx wrangler d1 migrations apply leaderboard --remote
npx wrangler deploy
```

Migration 0008 copies relational data into the consolidated tables while retaining the source tables. Migration 0009 is intentionally non-destructive; the completed `admin_setup` table is dropped only during the final cleanup. Deploy while `STORAGE_MODE` is still `kv`, so the current Worker continues using its existing KV data sources.

## Stage 2: copy KV data

Sign in to the owner Admin Panel and run the storage migration action once. It copies all unexpired keys from the seven KV namespaces into D1, preserving expiration and metadata. It is safe to run again.

The report must include all seven namespaces and show zero conflicts and zero errors. Revision personal-sync and leaderboard keys are skipped only when their data exactly matches the corresponding D1 user record. Expired KV keys are intentionally not copied.

Do not continue if any namespace is unavailable or the report is unsuccessful.

## Stage 3: switch reads and writes to D1

After Stage 2 succeeds, change this line in `wrangler.toml`:

```toml
STORAGE_MODE = "kv"
```

to:

```toml
STORAGE_MODE = "d1"
```

Then deploy:

```powershell
npx wrangler deploy
```

Keep all seven KV bindings configured during verification. The Worker will now use D1 for application storage while the original KV namespaces remain untouched as a rollback source.

Check account login, admin login, notifications, QuoteVault submissions and moderation, DateVault submissions and moderation, Revision sync and publication, themes, feedback, and rate limits. Run the owner Test Centre health and migrations tests as well.

## Stage 4: verify data before cleanup

Run the read-only parity checks:

```powershell
npx wrangler d1 execute leaderboard --remote --file maintenance/storage-preflight.sql
```

Every reported mismatch count must be zero. Review the namespace totals and expired-key counts too. Do not proceed if any source record is missing or differs from its consolidated copy.

Then, and only then, run the final D1 cleanup:

```powershell
npx wrangler d1 execute leaderboard --remote --file maintenance/storage-drop-legacy.sql
```

This removes the twelve superseded tables, including `admin_setup`. The six permanent application tables remain.

## Stage 5: remove KV bindings and namespaces

Only after the D1-backed Worker and all functional checks pass, remove the seven KV bindings from `wrangler.toml` in a separate code change and deploy it. The application uses the D1 storage adapter; no live application route should depend on the old KV bindings.

After that deployment is confirmed healthy, delete the seven now-unused KV namespaces in Cloudflare. Keep the local backups private; do not commit them.

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
