# Cloudflare storage migration

The Worker now uses D1 as the primary store for revision sync data and custom themes. Existing KV records are copied into D1 by an owner-controlled, repeatable migration. KV copies are deliberately retained as backups.

## Before deploying

The owner has confirmed that the remote Wrangler migration listing returned `No migrations to apply!`. Wrangler therefore reports all five tracked migrations as already applied. Do not run migrations manually or rerun completed migrations. Recheck the migration list before deploying; if it still reports no pending migrations, proceed without applying anything.

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

### Migration and deployment order

1. Confirm the remote migration history:

   `npx wrangler d1 migrations list leaderboard --remote`

2. If Wrangler reports `No migrations to apply!`, do not run the apply command. If it lists a genuinely pending migration, stop and inspect the migration history before applying anything.

3. Once all five migrations are confirmed applied and backups are safely stored, deploy the Worker:

   `npx wrangler deploy`

The five tracked migrations are:

- `0001_admin_roles.sql`
- `0002_persistent_user_data.sql`
- `0003_one_time_admin_setup.sql`
- `0004_password_accounts.sql`
- `0005_revision_leaderboard.sql`

The new Worker expects the `revision_leaderboard` table from migration 0005.

## Initial owner setup

1. Open GCSE Vault and link the account that should own administration.
2. Open the Admin Panel.
3. Expand **First owner setup** and enter the existing `ADMIN_KEY` secret once.
4. Sign in using that account. A permanent D1 setup lock is claimed atomically with the owner promotion. The same key is rejected for every later account, even if the owner role is changed manually. The setup lock is not removed when an account's role changes.
5. Remove the `ADMIN_KEY` secret from the Worker environment after successful setup. It is no longer needed.

The owner can then grant or remove admin access from **Account permissions**. Admins can moderate submissions but cannot change account roles.

## Copy existing KV data

While signed in as the owner, select **Migrate existing storage to D1** in the Admin Panel. It processes records in small pages and can safely be run again if interrupted.

The migration copies:

- Revision sync records from the `REVISION` KV namespace.
- Revision leaderboard records from the `REVISION` KV namespace.
- Custom themes from the `THEMES` KV namespace.

The Worker also imports a user's remaining legacy KV data when that user next loads revision data or custom themes. Revision leaderboard reads now use D1; new leaderboard writes update D1 and retain KV backup copies. Custom themes also use D1 as the primary store and retain KV backup copies.

Do not delete the old KV namespaces or their records. Keep them until the migrated D1 data has been checked against the original data and cross-device testing has passed.

## Verification still required

The repository integration can update and test code, but it cannot access the live Cloudflare account, export its D1 database, enumerate production KV records, apply migrations, or deploy the Worker. Those production steps must be completed from an authenticated Wrangler session. The migration endpoint reports scanned and copied counts; compare those with the original namespace counts before considering the migration complete.

## Password account rollout

After the Worker and website updates are deployed together, existing users can open the account dialog from the account-key panel and choose **Set password for linked account**. They prove control of their existing account key once, then use username and password on other devices. The existing key remains a recovery credential and should be kept private. The Worker stores only a salted PBKDF2 password hash and hashed session tokens. Passwords cannot be viewed by administrators. This is not end-to-end encryption; account data remains readable to the Worker and database.

Do not remove the existing user-key flow during the migration period. Users who have not yet set a password continue using their existing account key. Confirm the D1 migration and backup before deployment.
