# Overmux WWW infrastructure

Alchemy v2 deploys `apps/www` as one persistent Cloudflare Worker named `overmux-main`. The `main` stage owns the Worker and serves production at `https://overmux.com`. A `pr-<number>` stage uploads a zero-traffic immutable version of that Worker and assigns it a stable branch alias.

## Credentials and bootstrap

GitHub Actions needs these repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Set the production and non-production PostHog project ingestion keys as the `PUBLIC_POSTHOG_KEY` and `STAGING_PUBLIC_POSTHOG_KEY` repository variables. Main deployments use the production key; preview deployments use the staging key. Set the optional `CLOUDFLARE_WORKERS_SUBDOMAIN` repository variable if the account subdomain is not `richardgill88`.

Generate an account-scoped token with Alchemy's permission picker:

```sh
pnpm --filter @overmux/infra exec alchemy cloudflare create-token --account-id "$CLOUDFLARE_ACCOUNT_ID"
```

The token must be able to deploy Worker scripts, versions, assets, bindings, preview URLs, and custom domains; it also needs permission to read the `overmux.com` zone and bootstrap Alchemy's state store. `Cloudflare.state()` stores remote state in the account-scoped `alchemy-state-store` Worker and its Durable Object. It creates its own state token and encryption key, so no separate Alchemy state secrets belong in GitHub.

The `overmux.com` zone must already be active in the same Cloudflare account. The production deployment declaratively attaches the apex hostname to the Worker; Cloudflare then manages its DNS record and edge certificate. No manual apex DNS record is required. `www.overmux.com` is intentionally not configured.

Bootstrap once before the first CI deployment:

```sh
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
  pnpm --filter @overmux/infra exec alchemy cloudflare bootstrap
```

## Local development

The app-only authoring loop is:

```sh
pnpm dev-www
```

The Cloudflare-compatible Alchemy loop uses local state and workerd without changing remote resources:

```sh
POSTHOG_LOGS_ENDPOINT=http://127.0.0.1:4318/i/v1/logs pnpm dev-www-cloudflare
```

`POSTHOG_LOGS_ENDPOINT` is optional and defaults to PostHog EU ingestion. `PUBLIC_POSTHOG_KEY` is safe to expose; local mode supplies a dummy value.

## Plan, deploy, and destroy

Remote commands fail early unless the required deployment metadata is present.

```sh
# Inspect and deploy main
DEPLOYMENT_KIND=main GIT_SHA=$(git rev-parse HEAD) PUBLIC_POSTHOG_KEY=... \
  pnpm --filter @overmux/infra exec alchemy plan alchemy.run.ts --stage main
DEPLOYMENT_KIND=main GIT_SHA=$(git rev-parse HEAD) PUBLIC_POSTHOG_KEY=... \
  pnpm --filter @overmux/infra deploy --stage main --yes

# Deploy a zero-traffic PR preview against main
DEPLOYMENT_KIND=preview PR_BRANCH=feature/docs GIT_SHA=$(git rev-parse HEAD) PUBLIC_POSTHOG_KEY=... \
  pnpm --filter @overmux/infra deploy --stage pr-123 --yes

# Remove only that preview stage/version
pnpm --filter @overmux/infra destroy --stage pr-123 --yes
```

The production URL is `https://overmux.com`; the stable `workers.dev` URL remains enabled to support branch-version previews. Preview URLs have the form `https://<branch-alias>-overmux-main.<account-subdomain>.workers.dev`. Main must exist before the first preview deploy.

## First remote verification

1. Run the manual `main` workflow and open `https://overmux.com`.
2. Confirm one invocation log reaches the PostHog EU project.
3. Run a manual preview for a PR number, branch, and SHA.
4. Open its environment URL and confirm main is unchanged.
5. Run manual `destroy-preview` for the PR number and confirm main remains available.

Local checks cannot verify account token permissions, the Cloudflare zone association and certificate issuance, the account's actual Workers subdomain, remote state bootstrap, preview alias provisioning, GitHub deployment URL publication, or production PostHog ingestion.
