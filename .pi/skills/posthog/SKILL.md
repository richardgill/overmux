---
name: posthog
description: Use the PostHog HTTP API directly with curl for Overmux analytics, events, exceptions, and main/preview Worker logs.
---

Do not use the PostHog MCP for this skill.
Overmux website Worker logs are sent directly to PostHog from `apps/www/src/lib/worker-logs.ts`.
Use the EU PostHog API for EU-hosted projects.

Choose the intended staging or production project explicitly from your PostHog settings and set `PUBLIC_POSTHOG_PROJECT_ID` to its numeric ID. Do not infer production from an absent setting. Local and preview queries should use your staging project.

## Authentication

Create a personal API key at https://eu.posthog.com/settings/user-api-keys with `logs:read` plus only the additional query scopes needed. Load it into `POSTHOG_OVERMUX_PERSONAL_API_KEY` using your secret manager or private shell environment, not a tracked file. The optional `pnpm setup-local-dot-env` workflow is described in the repository README. Never print the key or include it in browser configuration.

## Logs

Query Overmux Worker logs:

```bash
: "${PUBLIC_POSTHOG_PROJECT_ID:?Select a PostHog project explicitly}"
: "${POSTHOG_OVERMUX_PERSONAL_API_KEY:?Load a personal API key securely}"
curl -sS "https://eu.posthog.com/api/projects/${PUBLIC_POSTHOG_PROJECT_ID}/logs/query/" \
  -H "Authorization: Bearer $POSTHOG_OVERMUX_PERSONAL_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{
    "query": {
      "dateRange": { "date_from": "-1h", "date_to": null },
      "serviceNames": ["overmux-www"],
      "severityLevels": [],
      "orderBy": "latest",
      "limit": 100
    }
  }' | jq '.results[] | {timestamp, severity_text, body, resource_attributes}'
```

The service name is `overmux-www`. Distinguish `main`, `preview`, and `local` with the `deployment.environment.name` resource attribute. Preview records also include their deployed Git SHA.

Useful filters:

```json
{
  "query": {
    "dateRange": { "date_from": "-30m", "date_to": null },
    "serviceNames": ["overmux-www"],
    "severityLevels": ["error"],
    "searchTerm": "exception",
    "filterGroup": [
      { "type": "log_resource_attribute", "key": "service.name", "operator": "exact", "value": "overmux-www" },
      { "type": "log_resource_attribute", "key": "deployment.environment.name", "operator": "exact", "value": "preview" }
    ],
    "orderBy": "latest",
    "limit": 100
  }
}
```

Log `body` is JSON emitted by `apps/www/src/lib/worker-logs.ts`. Resource attributes include the service name, deployment environment, Worker script name, and Git SHA.

## API references

- Official PostHog API docs: `https://posthog.com/docs/api`
- Official Query API docs: `https://posthog.com/docs/api/queries#creating-a-query`
- PostHog schema: `https://eu.posthog.com/api/schema/` - see `LogsQuery`, `_LogsQueryRequest`, `_LogPropertyFilter`, `HogQLFilters`, and `HogQLQuery`.

## Source references

Overmux:

- `apps/www/src/lib/worker-logs.ts`
- `apps/www/src/lib/posthog-server.ts`
- `apps/www/src/lib/worker-env.ts`
- `tooling/infra/alchemy.run.ts`

Useful files in the PostHog repo (https://github.com/PostHog/posthog):

- https://github.com/PostHog/posthog/blob/master/posthog/schema.py
- https://github.com/PostHog/posthog/blob/master/posthog/api/query.py
- https://github.com/PostHog/posthog/blob/master/posthog/hogql/filters.py
- https://github.com/PostHog/posthog/blob/master/products/posthog_ai/skills/querying-posthog-data/references/models-variables.md

For faster lookups across many files, clone repos locally to `~/code/reference-repos/` and grep there:

```bash
gh repo clone PostHog/posthog ~/code/reference-repos/posthog
```

Use these sources to confirm request shapes and API behavior when the docs are vague.
