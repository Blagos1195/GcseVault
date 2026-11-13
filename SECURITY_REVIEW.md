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


## Worker endpoint coverage

The route inventory was checked against the current Worker source. The groups below describe the access checks found in the handlers and shared guards.

| Area | Endpoints reviewed | Access model |
|---|---|---|
| Account credentials | `/account/setup`, `/account/challenge`, `/account/login`, `/account/reset`, `/account/session`, `/account/logout` | Setup/reset rely on possession of the legacy account key. Login is throttled by IP plus username. Session reads and logout require the account-session header. |
| Admin authentication | `/auth`, `/auth/session`, `/auth/logout`, `/admin/status`, `/admin/bootstrap` | Admin sessions are bound to a live account session and current role. Bootstrap uses the one-time setup secret. Status exposes only whether an owner/admin has been configured. |
| Owner administration | `/admin/users`, `/admin/leaderboard-visibility`, `/admin/ai-access`, `/admin/migrate-storage`, `/admin/test-run` | Owner role is checked server-side for privileged operations. |
| Admin workspace | `/admin/published`, `/admin/push/subscribe`, `/admin/notifications`, `/admin/notifications/read`, `/admin/notifications/delete`, `/admin/moderation-log` | Requires a valid admin session. Notification reads/deletes are scoped to the authenticated admin. |
| QuoteVault and DateVault | `/quotes`, `/pending`, `/submit`, `/approve`, `/reject`, `/withdraw`, `/update-pending`, `/update-public`, `/delete`, and the corresponding `/dv/*` routes | Published content is public. Submission requires an account session. Moderation and content-management routes require admin access. Withdrawal is account-scoped. |
| Submission decisions | `/submissions/notifications`, `/submissions/private/remove`, `/submissions/notifications/resolve` | Requires the signed-in account session; records are queried and changed using that session's user key. |
| Leaderboards and account data | `/lb/list`, `/lb/get`, `/lb/register`, `/lb/username-available`, `/lb/update-theme`, `/lb/streak`, `/themes/save`, `/themes/list`, `/themes/delete` | Public responses are limited to leaderboard or username information. Account-data reads and writes use account checks; password-protected accounts require a live session. |
| Revision | `/revision/sync`, `/revision/leaderboard`, `/revision/public`, `/revision/public/pending`, `/revision/public/admin-list`, `/revision/public/approve`, `/revision/public/reject`, `/revision/public/update`, `/revision/public/admin-delete`, `/revision/public/delete` | Private sync and publication require account authentication. Moderation routes require admin access. Public reads expose published material only. |
| Revision review schedules | `/review-schedules` | Requires a valid password-account session and scopes data to that session's user key. |
| Feedback and diagnostics | `/feedback/submit`, `/feedback/list`, `/feedback/update`, `/feedback/delete` | Submission is public with a 12 KB body limit and best-effort per-IP throttling. Listing and management require admin access. |
| AI | `/ai/auth`, `/ai/session`, `/ai/logout`, `/generate` | AI sessions are linked to live account sessions and current AI permission. |

## Additional findings from the endpoint review

- Account sessions have a 30-day expiry. Logging out revokes the current session, and password reset revokes all sessions for that account. There is not yet a dedicated account-wide **sign out all devices** control or session-management screen.
- The moderation audit records approval/rejection actions. Owner changes to account roles and AI access are not currently recorded in that same audit log.
- Login and feedback have rate limits. Other public write paths, including account setup/reset and content submissions, do not currently share a common rate-limit layer.
- Feedback has an explicit request-body limit. Request-size limits are not yet applied consistently to every JSON endpoint, particularly large account and Revision sync payloads.
- Error reports retain fingerprints, timestamps, app versions and diagnostic context. The admin workspace does not yet provide a grouped recurring-error trend view.
- The production Test Centre still performs isolated storage/permission checks. The new CI lifecycle test exercises QuoteVault submission through approval and publication with synthetic sessions and in-memory storage, but it is not a browser test and does not replace a production Test Centre flow using a dedicated disposable account.

This endpoint inventory is a source review, not proof against every runtime or infrastructure failure. The remaining compatibility and operational limitations above should be treated as open work rather than assumed solved.
