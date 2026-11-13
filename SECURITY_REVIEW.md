# Security review

Reviewed the Worker authentication and account routes, moderation endpoints, account-scoped data operations, feedback handling, notification ownership, and the related QuoteVault, DateVault, Revision, and admin clients.

## Improvements in this change

- Submission outcome messages now name the quote, date, or Revision notes being reviewed.
- Resolving a QuoteVault or DateVault approval now replaces every saved copy with the same submission ID before storing the selected version. This prevents stale copies and duplicate cards from surviving a moderation decision.
- The Worker now accepts only outcome-appropriate choices: approved items can be kept or replaced; denied items can be kept or removed.
- Feedback requests are measured after reading the body, so a missing or misleading Content-Length header cannot bypass the 12 KB limit.
- Feedback submissions are limited to five per IP address per 15-minute window to reduce automated inbox and push-notification spam.
- Automatic error reports use the feedback system. Deleting a feedback record or its admin inbox notification does not create a user-facing submission decision. User-facing submission notifications are created only by the QuoteVault, DateVault, and Revision moderation routes.

## Existing protections verified

- Admin sessions are linked to a live account session and the current user role is read from D1 on each request.
- Owner-only account management and Test Centre routes check for the owner role server-side.
- Submission notifications are queried and resolved using the authenticated account's user key, not a user key supplied in the request body.
- Admin notification reads and deletes are scoped to the authenticated admin's own user key.
- Public leaderboard responses and username lookups do not return account keys or private revision data.
- SQL values are parameterized. Dynamic SQL column names in account notification handling are selected from fixed internal allowlists.
- QuoteVault and DateVault withdrawal routes check the stored pending-ID list before deleting a pending KV item.

## Remaining security considerations

- The legacy account setup and password-reset design uses the account's random `userKey` as proof of account ownership. The key is stored locally by the client and must be treated as a secret. Anyone who obtains it can set up or reset that account's password. There is no independent email-based recovery mechanism in the current design. This review leaves that compatibility behaviour unchanged.
- The feedback rate limit uses a KV read followed by a write, rather than an atomic counter. It is a practical abuse barrier, not a strict distributed quota; concurrent requests can occasionally exceed the threshold.
- The Worker allows cross-origin requests. Its authenticated routes use explicit bearer-token headers rather than ambient cookies, so this is not by itself an authentication bypass. Preventing script injection in user-generated content remains important.
- This is a source-level review plus automated tests. It does not prove the live Cloudflare deployment is current, and it is not a penetration test of the deployed service.

## Not changed

No user data, account records, moderation history, or feedback records were deleted or migrated by this review. No backup system was added.
