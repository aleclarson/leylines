# Leylines Docs

Start with [Getting Started](./getting-started.md) if you want to write and
inspect your first local log entries.

## Guides

- [Getting Started](./getting-started.md): install Leylines, write a Node entry,
  inspect it with the CLI, and capture browser logs in Vite.
- [Concepts](./concepts.md): understand stores, entries, scopes, metadata,
  properties, redaction, retention, and collapsed values.
- [Node API](./node-api.md): use `openScopedLogs`, scoped loggers, queries,
  tails, expansion, and low-level store access.
- [Vite And Browser](./vite-browser.md): capture browser logs during Vite serve
  mode and use the browser singleton logger.
- [CLI And Agent Workflows](./cli-agent-workflows.md): investigate logs through
  compact human output and stable JSON output.
- [PostHog Development Capture](./integrations/posthog-development.md): redirect local
  PostHog browser events into Leylines without forwarding them.

## Source Of Truth

Public TSDoc owns exact API behavior. These guides own usage flow, concepts,
and API-selection guidance. Generated declarations own exact signatures.
