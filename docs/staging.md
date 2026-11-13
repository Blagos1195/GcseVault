# GCSE Vault staging environment

The manual **Deploy isolated staging** GitHub Actions workflow provisions and deploys a separate staging copy of the site and Worker API.

## One-time GitHub secrets

Add these repository secrets before running the workflow:

- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: an API token with permission to list/create D1 databases, list/create Workers KV namespaces, deploy Workers, manage Pages projects, and read the Workers.dev subdomain.
- `STAGING_ADMIN_KEY`: a new random admin setup key used only by staging. Do not reuse the production admin key.

The Cloudflare account must have a Workers.dev subdomain enabled.

## What the workflow creates

The workflow is idempotent. It reuses or creates:

- D1 database: `gcsevault-staging`
- Seven KV namespaces prefixed `gcsevault-staging-`
- Cloudflare Pages project: `gcsevault-staging`
- Worker: `quotevault-api-staging`

It applies the repository's D1 migrations to the staging database, deploys the staging Worker, then deploys the static site to the Pages preview branch `staging`.

The staging site is served under `/GcseVault/` so existing application paths continue to work. Its generated `worker-config.js` points to the staging Worker. Production configuration and resource IDs are not copied into the staging deployment.

## Staging limitations

- Push notifications are disabled in staging until a separate VAPID key pair is configured.
- The Cloudflare Workers AI binding is intentionally omitted to avoid accidental AI usage during testing.
- Use disposable test accounts and test data only. Staging has its own D1 and KV stores.
- The workflow is manual. It does not deploy staging on every push and does not deploy or modify production.

The expected site URL is `https://gcsevault-staging.pages.dev/GcseVault/`. The workflow prints the actual Worker URL after deployment.
