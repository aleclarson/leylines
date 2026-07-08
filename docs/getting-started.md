# Getting Started

> Write the first local entries, inspect them from the CLI, and connect browser
> capture without choosing a hosted observability system.

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

The inferred store path is local to the current working tree:

```sh
ley path
```

For a default store, the command prints an absolute path ending in
`.leylines/logs.sqlite`.

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

This writes one structured entry with scope `app.startup` and property
`session.id=dev-1`.

## Inspect Logs From The CLI

The CLI reads the same store:

```sh
ley --limit 20
ley --scope-prefix app
ley scopes
```

Use compact output for quick reading. Use `--json` when output will be parsed,
stored, compared, or when exact entry fields are needed.

After the first log example, `ley --scope-prefix app` prints the `app.startup`
entry, and `ley scopes` includes `app.startup`.

## Capture Browser Logs In Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { leylines } from 'leylines/vite'

export default defineConfig({
  plugins: [
    leylines({
      scope: 'browser',
      captureConsole: ['warn', 'error'],
      stripProduction: true,
    }),
  ],
})
```

Application code can use the injected browser logger:

```ts
import { logger } from 'leylines/browser'

logger.info('router', 'route loaded', { route: '/settings' })
logger.warn('checkout', 'submit retrying', { attempt: 2 })
```

During Vite serve mode, the plugin injects `logger.connect(...)` before app code
and registers a local ingestion endpoint. Production builds are quiet unless
`production: true` is configured. With `stripProduction: true`, standalone
browser logger calls are removed from production modules.

Query browser entries from the same terminal surface:

```sh
ley --scope router --json
```

## Next Guides

- [Concepts](./concepts.md) explains scopes, entries, redaction, retention, and
  collapse behavior.
- [Node API](./node-api.md) covers long-running stores, child loggers, queries,
  tailing, and expansion.
- [Vite And Browser](./vite-browser.md) covers browser capture and singleton
  logger usage.
- [CLI And Agent Workflows](./cli-agent-workflows.md) covers investigation
  patterns and machine-readable output.
- [PostHog Development Capture](./integrations/posthog-development.md) covers
  redirecting local product analytics into Leylines.
