# Cloudflare storage migration

The Worker now uses D1 as the primary store for revision sync data and custom themes. Existing KV records are copied into D1 by an owner-controlled, repeatable migration. KV copies are deliberately retained as backups.

## Before deploying

1. Back up the current D1 database:

   `npx wrangler d1 export leaderboard --remote --output=leaderboard-backup.sql`

2. Apply the tracked migrations:

   `npx wrangler d1 migrations apply leaderboard --remote`

3. Confirm all tracked migrations completed:

   - `0001_admin_roles.sql`
   - `0002_persistent_user_data.sql`
   - `0003_one_time_admin_setup.sql`
   - `0004_password_accounts.sql`
   - `0005_revision_leaderboard.sql`

4. Deploy the Worker:

   `npx wrangler deploy`

Do not deploy the new Worker before applying all four migrations. It expects the account role, storage and password-session tables to exist.

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
