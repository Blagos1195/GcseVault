# Password account design

## Account model

- Users sign in with a username and password.
- Passwords are never stored. The Worker stores a unique random salt and a PBKDF2-HMAC-SHA-256 hash using 600,000 iterations.
- Successful sign-in creates a random 256-bit session token. Only its SHA-256 hash is stored in D1.
- Account sessions expire after 30 days and can be revoked by logging out.
- Account passwords retain the existing internal user key so QuoteVault, DateVault, Revision, leaderboards, themes and moderation records remain linked.
- Existing accounts can add a password after proving access with their existing user key. New devices can then sign in with username and password.

## Access control

- Password-protected account endpoints require a valid account session matching the account key.
- Existing accounts without a password remain compatible during migration.
- Admin roles remain separate from ordinary account access. Admin login requires an account session for password-protected accounts.
- Public leaderboard results do not expose account keys or password data.

## Recovery

There is no email-based password reset in the current project. Keep the existing account key private as an account recovery credential until a separate recovery process is implemented. If a user loses both their password and their account key, the account cannot currently be recovered.

## Scope and limitations

This is conventional password authentication, not end-to-end encryption. Passwords are not visible to administrators, but the Worker and database still process and store account content in readable form. Administrators with sufficient server/database access may be able to access account data. This is proportionate for revision progress and study sets, which are not intended to hold sensitive personal information.

Users should choose a unique password rather than reusing one from another service. Password hashing makes a database leak less immediately damaging, but weak or reused passwords can still be guessed offline. Login attempts are rate-limited.

## Migration and rollout

1. Apply the additive D1 migration 0004_password_accounts.sql.
2. Deploy the Worker and website changes together.
3. Existing users keep their account key and add a password from the account dialog. Their existing leaderboard, theme and Revision data remain linked to the same internal account.
4. Users signing in on another device use their username and password. The Worker issues a session and returns the linked internal account key to that signed-in browser.
5. Do not remove legacy account-key support until users have had time to add passwords and the remaining legacy accounts have been handled.

No production migration or deployment has been performed from this branch.
