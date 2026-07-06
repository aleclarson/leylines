# Getting Started

Leylines gives local applications and coding agents a durable, queryable log
timeline without adopting a hosted observability stack. Use it when you want
structured scoped events, redaction before persistence, bounded retention, and
stable CLI/JSON output on the same machine as the app.

Leylines is not a metrics system, tracing backend, crash reporter, or hosted log
aggregator. It is a local event store for development, scripts, services, and
agent workflows.

## Requirements

- Node.js 22.18 or newer.
- ESM-capable TypeScript or JavaScript.
- A writable local path for the SQLite-backed store.

```sh
pnpm add leylines
```

## First Node Log

```ts
import { openScopedLogs } from 'leylines'

const logs = openScopedLogs()
const logger = logs.logger({
  scope: 'app.startup',
  properties: { session: { id: 'dev-1' } },
})

logger.info('app booted', {
  properties: { route: '/' },
})

console.log(logs.query({ scopePrefix: 'app', includeDebug: true }).entries)
logs.close()
```

This writes one structured entry with a stable scope and queryable properties.

## Inspect Logs From The CLI

The CLI reads the same store:

```sh
ley --limit 20
ley --scope-prefix app --json
ley scopes
```

Use `--json` when another tool or agent will consume the output.

## Capture Browser Logs In Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { scopedLogsVitePlugin } from 'leylines/vite'

export default defineConfig({
  plugins: [
    scopedLogsVitePlugin({
      scope: 'browser',
      captureConsole: ['warn', 'error'],
    }),
  ],
})
```

Application code can use the injected browser logger:

```ts
import { logger } from 'leylines/browser'

logger.info('route loaded', { route: '/settings' })
logger.child({ scope: 'checkout' }).warn('submit retrying')
```

During Vite serve mode, the plugin injects `logger.connect(...)` before app code
and registers a local ingestion endpoint. Production builds are quiet unless
`production: true` is configured.

## Next Guides

- [Concepts](./concepts.md) explains scopes, entries, redaction, retention, and
  collapse behavior.
- [Node API](./node-api.md) covers long-running stores, child loggers, queries,
  tailing, and expansion.
- [Vite And Browser](./vite-browser.md) covers browser capture and singleton
  logger usage.
- [CLI And Agent Workflows](./cli-agent-workflows.md) covers investigation
  patterns and machine-readable output.
- [PostHog Development Capture](./posthog-development.md) covers redirecting
  local product analytics into Leylines.
