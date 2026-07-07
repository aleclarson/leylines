# Leylines

Leylines is a local scoped log store for applications and coding agents. It
captures structured entries with stable scopes, queryable properties, redaction
before persistence, bounded retention, and deterministic CLI/JSON output.

It ships as one package with:

- a Node.js API for writing, querying, tailing, and expanding logs
- a `ley` CLI for agent and operator workflows
- a Vite development plugin plus browser logger

Leylines uses the built-in `node:sqlite` module, so it targets modern Node.js
runtimes that include that API.

```sh
pnpm add leylines
```

## Node API

```ts
import { openScopedLogs } from 'leylines'

const logs = openScopedLogs()
const logger = logs.logger({
  scope: 'checkout.cart',
  properties: { request: { id: 'req-123' } },
})

logger.info('cart opened', { properties: { cartId: 'cart-1' } })
logger.error('checkout failed', {
  properties: { cartId: 'cart-1' },
  error: new Error('payment declined'),
})

const page = logs.query({
  scopePrefix: 'checkout',
  minLevel: 'warn',
  properties: [{ path: 'cartId', equals: 'cart-1' }],
})

console.log(page.entries)
logs.close()
```

Each entry has a stable id, timestamp, sequence, level, scope, message,
metadata, structured properties, and optional error details. Supported levels
are `debug`, `info`, `warn`, and `error`.

`debug` entries are hidden from default human-style queries unless `includeDebug`
is set or `levels: ['debug']` is requested explicitly.

## CLI

The CLI reads the same inferred store as the Node API.

```sh
ley
ley --scope-prefix checkout --min-level warn
ley --property request.id=req-123
ley scopes
ley expand '<entry-id>:properties.payload'
ley path
```

Filtering supports:

- time: `--since`, `--until`
- entry boundaries: `--before`, `--after`
- levels: `--level debug,info`, `--min-level warn`, `--include-debug`
- scopes: `--scope`, `--scope-prefix`
- text: `--text`, `--regex`
- properties: `--property path=value`
- pagination: `--limit`

Default output is compact and chronological, which works well for quick human
or agent triage. Use `--json` when output will be parsed, stored, compared, or
when exact entry fields such as ids, sequences, and metadata are needed.

## Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { leylines } from 'leylines/vite'

export default defineConfig({
  plugins: [
    leylines({
      scope: 'browser',
      captureConsole: ['warn', 'error'],
      captureErrors: true,
      captureRejections: true,
    }),
  ],
})
```

The plugin registers a local ingestion endpoint and injects the browser logger
during Vite serve mode. Production build capture is quiet by default; pass
`production: true` only when browser capture is intentionally desired.

PostHog product metrics can be redirected into the same local store during
development:

```ts
leylines({
  posthog: true,
})

posthog.init(projectKey, {
  api_host: '/__leylines/posthog',
})
```

Application code can also use the browser logger directly:

```ts
import { logger } from 'leylines/browser'

logger.connect({
  endpoint: '/__scoped_logs',
  scope: 'app.router',
})

logger.info('route loaded', { route: '/settings' })
```

## Redaction And Retention

Redaction runs before entries are persisted. Leylines redacts common
secret-looking property names such as `token`, `authorization`, `password`,
`secret`, `cookie`, and `apiKey`, plus credential-shaped values such as bearer
tokens.

```ts
const logs = openScopedLogs({
  redaction: {
    rules: [{ name: /^stripe/i, replacement: '[STRIPE SECRET]' }],
  },
  retention: {
    maxEntries: 10_000,
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  },
})
```

Large values are collapsed in default entries and can be retrieved later with
`logs.expand(id)` or `ley expand`.

## Agent Workflow

Start broad, discover scopes, then pivot through structured properties:

```sh
ley --limit 30
ley scopes
ley --scope-prefix checkout
ley --property request.id=req-123 --json
```

Agents can start with compact output when reading logs as context. Switch to
JSON for automation or exact fields instead of inspecting SQLite files directly.
Store schema and file layout are internal implementation details.

## Documentation

- [Getting Started](docs/getting-started.md) gets a store, Node logger, CLI, and
  Vite browser capture working.
- [Concepts](docs/concepts.md) explains entries, scopes, metadata, properties,
  redaction, retention, and collapsed values.
- [Node API](docs/node-api.md) covers direct store usage, child loggers, queries,
  tailing, and expansion.
- [Vite And Browser](docs/vite-browser.md) covers browser capture and singleton
  logger usage.
- [CLI And Agent Workflows](docs/cli-agent-workflows.md) covers investigation
  patterns and JSON output for agents.
- [PostHog Development Capture](docs/integrations/posthog-development.md) covers redirecting
  local PostHog events into Leylines.
