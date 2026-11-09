# Cloudflare storage migration

The Worker now uses D1 as the primary store for revision sync data and custom themes. Existing KV records are copied into D1 by an owner-controlled, repeatable migration. KV copies are deliberately retained as backups.

## Production migration and deployment status

The owner has confirmed that the remote Wrangler migration listing returned `No migrations to apply!` after successfully applying `0005_revision_leaderboard.sql`. Wrangler reported the migration successful and the subsequent list showed no pending migrations.

The owner then successfully ran `npx wrangler deploy`. The deployed Worker URL is `https://quotevault-api.noah-l-barker.workers.dev`, with version ID `fb9b7e72-07c9-44c0-a8e0-4d19ec2c7b8e`.

The five tracked migrations are:

- `0001_admin_roles.sql`
- `0002_persistent_user_data.sql`
- `0003_one_time_admin_setup.sql`
- `0004_password_accounts.sql`
- `0005_revision_leaderboard.sql`

Do not rerun completed migrations. The repository connection cannot independently inspect the live Cloudflare database or deployment; the production status above is based on the owner's Wrangler output.

The owner has also completed and checked the production backups:
- D1 export `leaderboard-backup.sql` downloaded successfully.
- The `REVISION` namespace contained five keys and its JSON bulk export was validated.
- The `THEMES` namespace returned an empty key list, so there were no values to export.

Keep the backup files outside the repository and do not commit them.

### Backup commands on Windows PowerShell

PowerShell's native redirection can write UTF-16 files that Wrangler cannot parse. Use `cmd /c` for the KV key-list and bulk-get commands:

```powershell
npx wrangler d1 export leaderboard --remote --output=leaderboard-backup.sql

cmd /c "npx wrangler kv key list --binding=REVISION --remote > revision-keys.json"
cmd /c "npx wrangler kv bulk get revision-keys.json --binding=REVISION --remote > revision-backup.json"

cmd /c "npx wrangler kv key list --binding=THEMES --remote > themes-keys.json"
```

Inspect each key-list file. Only run `kv bulk get` when that namespace contains at least one key. An empty key list means there are no values to export. Validate non-empty exports locally without printing their contents:

```powershell
$backup = Get-Content .\revision-backup.json -Raw | ConvertFrom-Json
$backup.PSObject.Properties.Count
```

### Completed migration and deployment commands

The owner successfully ran:

```powershell
npx wrangler d1 migrations apply leaderboard --remote
npx wrangler d1 migrations list leaderboard --remote
npx wrangler deploy
```

The apply command ran only `0005_revision_leaderboard.sql`; the follow-up list returned `No migrations to apply!`. The Worker deploy completed successfully. Do not repeat these commands unless a future code change introduces a new migration or Worker deployment is intentionally required.

## Initial owner setup

**Completed in production.** The owner completed first-owner setup, signed in, and removed the `ADMIN_KEY` secret from the Worker environment. The one-time setup key is no longer needed.

The owner can grant or remove admin access from **Account permissions**. Admins can moderate submissions but cannot change account roles.

## Copy existing KV data

While signed in as the owner, select **Migrate existing storage to D1** in the Admin Panel. It processes records in small pages and can safely be run again if interrupted.

The migration copies:

- Revision sync records from the `REVISION` KV namespace.
- Revision leaderboard records from the `REVISION` KV namespace.
- Custom themes from the `THEMES` KV namespace.

The Worker also imports a user's remaining legacy KV data when that user next loads revision data or custom themes. Revision leaderboard reads now use D1; new leaderboard writes update D1 and retain KV backup copies. Custom themes also use D1 as the primary store and retain KV backup copies.

Do not delete the old KV namespaces or their records. Keep them until the migrated D1 data has been checked against the original data and cross-device testing has passed.

## Production data migration result

The owner completed the owner-controlled migration. The Admin Panel reported: `Migration complete: 3 copied, 1 already present, 0 skipped. Original KV copies remain available.` Four private Revision sync/leaderboard records were processed. The public Revision record remains in KV by design, and the `THEMES` namespace was empty. The migration is complete; all KV source records and local backups are being retained.

## Verification still required

Browser and cross-device checks remain. Test Revision sync, leaderboard updates, account switching and persistence on a second device. Also test QuoteVault and DateVault account, leaderboard and moderation flows. Do not delete KV records or local backups until these checks pass.

## Password account rollout

After the Worker and website updates are deployed together, existing users can open the account dialog from the account-key panel and choose **Set password for linked account**. They prove control of their existing account key once, then use username and password on other devices. The existing key remains a recovery credential and should be kept private. The Worker stores only a salted PBKDF2 password hash and hashed session tokens. Passwords cannot be viewed by administrators. This is not end-to-end encryption; account data remains readable to the Worker and database.

Do not remove the existing user-key flow during the migration period. Users who have not yet set a password continue using their existing account key. Confirm the D1 migration and backup before deployment.
