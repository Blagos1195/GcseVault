# Password accounts and private-data encryption

## Target

Replace the current bearer-key login with username/password accounts while keeping the existing QuoteVault, DateVault and Revision features. Private revision data must be encrypted in the browser before it is sent to the Worker. The Worker stores ciphertext and cannot decrypt it.

The current system is not a password account system: usernames are display names and the random `user_key` is a bearer credential. Existing account keys must be treated as migration credentials, not as new passwords.

## Account model

- Keep `users.user_key` as an internal stable account identifier so existing leaderboard and moderation records remain linked.
- Add a separate credential record for each account.
- Store only a salted password hash, never the password.
- Store a separate random encryption salt. The browser derives an AES-256-GCM key from the password and this salt.
- Store only a recovery-key-wrapped copy of the encryption key. The recovery key is generated in the browser and shown once.
- Store opaque, hashed session tokens. The raw token is held by the browser and is never stored in D1.
- Admin roles remain attached to the account. Admin access must require a valid account session, not an old account key.

## Private data

- Revision sets, flashcards, progress, notes and other private account content are encrypted before upload.
- The Worker validates account/session ownership and stores the encrypted envelope without receiving the encryption key.
- Public leaderboard fields remain separate and can remain readable.
- Publicly submitted revision notes are a deliberate publication action and are not private once approved.
- Existing plaintext Revision KV/D1 records remain untouched until each account completes an in-browser migration. The browser reads the user's existing data, encrypts it, uploads the ciphertext, verifies it, and only then marks that account migrated.
- The old copy is retained during rollout. No bulk server-side conversion is possible because the server must not have the decryption key.

## Recovery and password changes

- A password reset cannot decrypt old data. The user must supply their recovery key to restore the encryption key, then choose a new password and create a new wrapped recovery package.
- The recovery key must be high entropy, displayed once, and accompanied by a clear instruction to store it somewhere safe.
- Losing both the password and recovery key means encrypted data is unrecoverable. This is intentional, not an administrator-accessible recovery path.
- Password changes require the current password or recovery key. They re-wrap the same encryption key; they do not need to re-encrypt all data.

## Threat model and limitations

- Password hashing protects the authentication database from disclosure of plaintext passwords.
- End-to-end encryption prevents someone with database or KV read access from reading private revision content.
- A weak or reused password remains a risk to account access. A database thief can attempt offline password guesses against the stored password hash. However, guessing the account password alone does not reveal the independent random encryption key; the attacker also needs the separate 256-bit recovery key. Users should still choose a unique password, ideally with a password manager.
- A site operator who can change the JavaScript served to users could publish malicious code that captures passwords or decrypted data on a later login. E2EE protects stored data and backend access; it cannot protect users from a compromised application delivery pipeline.
- Public leaderboard data, public submissions, moderation records and operational metadata are not covered by private revision encryption.
- The existing QuoteVault/DateVault practice progress is primarily stored in browser local storage. It needs a separate inventory before any claim that all user data is end-to-end encrypted.

## Rollout order

1. Apply the additive D1 migration. Do not delete or rewrite existing data.
2. Implement and test password registration, login, logout, session expiry and account recovery.
3. Require account sessions for all private account operations. Remove bearer-key authentication only after every client and endpoint has been migrated.
4. Add the browser encryption flow and encrypted revision sync endpoint.
5. Add a per-account migration flow from existing Revision KV/D1 data, retaining old copies until verification.
6. Test registration, cross-device login, recovery, password changes, admin permissions, account switching, offline behavior and migration conflict handling.
7. Deploy only after the live database backup and migration have been independently verified.

## Implementation status

The additive schema and browser cryptography primitive are prepared on the audit branch. The private-data key is random and independent of the login password, so password reuse alone cannot decrypt stored revision content. They are not wired into the live account flows, and no production migration or deployment has occurred. The current bearer-key login remains active until the full conversion is complete.
