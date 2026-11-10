# GCSE Vault

GCSE Vault is a static study site with a shared account and theme layer, plus a Cloudflare Worker for account sync and shared data.

## Site structure

| Path | Purpose |
|---|---|
| `index.html` | Main site landing page |
| `quotes/` | QuoteVault: English Literature revision |
| `dates/` | DateVault: History revision |
| `revision/` | Revision workspace, flashcards, course materials and exam practice |
| `shared.js` | Shared account, theme and site utilities |
| `worker.js` | Cloudflare Worker API |
| `migrations/` | D1 database migrations |
| `tests/` | Automated regression and syntax tests |

Each site section keeps its page structure, stylesheet and application code separate:

- QuoteVault: `quotes/index.html`, `quotes/quotes.css`, `quotes/quotes.js`
- DateVault: `dates/index.html`, `dates/dates.css`, `dates/dates.js`
- Revision: `revision/index.html`, `revision/revision.css`, `revision/app.js`, `revision/practice.js`

Revision course catalogues and importable course packs are kept in `revision/catalogues/` and `revision/course-packs/`.

## Local checks

The project uses Node 22 or later and Node's built-in test runner. No package installation is needed for the current test suite.

```sh
npm test
```

The site is static and does not use a frontend build step. Keep browser code in the page-specific JavaScript files, shared cross-site behaviour in `shared.js`, and backend endpoints in `worker.js`.
