# Password account security

## How accounts work

- Users sign in with a username and password.
- The Worker stores a PBKDF2-HMAC-SHA-256 password hash with 600,000 iterations and a unique random salt. It does not store plaintext passwords.
- A successful login creates a cryptographically random 256-bit session token. D1 stores only the SHA-256 hash of that token.
- Sessions expire after 30 days. Logging out revokes the current session.
- The account's existing internal user key continues to link QuoteVault, DateVault, Revision, themes, leaderboard progress and moderation records.
- Existing users add a password to their current account from a device where that account is already linked. They can then sign in on other devices with username and password.

## Password advice

Users should choose a password that is unique to GCSE Vault. Reusing a password from another site is risky: if that other site is breached, attackers may try the same password here.

Password hashing slows down offline guessing if the database is stolen, but it cannot make a weak or reused password safe. Login attempts are rate-limited by IP address and username.

## Account recovery

The current recovery method relies on the existing account key. A user who still has a device linked to their account can use that key to set or reset the password. This key must be kept private and must not be shared.

There is no email-based reset or support-assisted identity verification yet. If a user loses both access to their linked device/account key and their password, the account cannot currently be recovered. Do not promise otherwise.

## What administrators can and cannot see

- Administrators do not have a way to view users' passwords. Only password hashes and salts are stored.
- This is not end-to-end encryption. Revision sets and other account data are processed by the Worker and stored in the database/KV in readable form.
- A person with sufficient access to the Cloudflare Worker, database or deployment pipeline may be able to access account data or change the application to collect data.
- This is a proportionate design for study progress and revision sets, not a system for sensitive personal, financial or medical information.

## Existing accounts and migration

- Existing account keys remain in use internally, so the password conversion does not create new user records or intentionally detach existing progress.
- An existing user must set a password from a browser that already has their account linked. Password login on a new device then retrieves the same internal account key.
- Accounts that have not set a password remain on the legacy account-key flow during the transition.
- Do not remove legacy support until users have had time to migrate and the remaining legacy accounts have been dealt with.

## Production rollout checklist

1. Back up the live D1 database and relevant KV namespaces.
2. Apply migrations 0001 through 0004 in order, checking the target database and migration history first.
3. Deploy the Worker and website changes together.
4. Test a new account, an existing account adding a password, login on a second device, logout, admin access, Revision sync and account recovery.
5. Compare user and progress counts before and after. Keep the KV copies until the migration is verified.
6. Do not delete old account keys or legacy data as part of this rollout.

The branch and draft PR contain code changes only. No production database migration, Cloudflare secret change or deployment has been performed.
