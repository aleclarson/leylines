# Leylines

Leylines is a local scoped log store for applications and coding agents. It
captures structured entries with stable scopes, queryable properties, redaction
before persistence, bounded retention, and deterministic CLI/JSON output.

It ships as one package with:

- a Node.js API for writing, querying, tailing, and expanding logs
- a `leylines` / `scoped-logs` CLI for agent and operator workflows
- a Vite development plugin plus browser logger

Leylines uses the built-in `node:sqlite` module, so it targets modern Node.js
runtimes that include that API.

```sh
pnpm add leylines
```

## Node API

```ts
import { openScopedLogs } from 'leylines'

const logs = openScopedLogs({ path: '.leylines/logs.sqlite' })
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

The CLI reads the same store as the Node API. Use `--store` to select a store or
set `SCOPED_LOGS_STORE`.

```sh
leylines --store .leylines/logs.sqlite
leylines --store .leylines/logs.sqlite --scope-prefix checkout --min-level warn
leylines --store .leylines/logs.sqlite --property request.id=req-123 --json
leylines scopes --store .leylines/logs.sqlite
leylines expand '<entry-id>:properties.payload' --store .leylines/logs.sqlite
leylines path --store .leylines/logs.sqlite
```

Filtering supports:

- time: `--since`, `--until`
- entry boundaries: `--before`, `--after`
- levels: `--level debug,info`, `--min-level warn`, `--include-debug`
- scopes: `--scope`, `--scope-prefix`
- text: `--text`, `--regex`
- properties: `--property path=value`
- pagination: `--limit`

Default output is compact and chronological. `--json` is the automation
contract and returns stable JSON fields.

## Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { scopedLogsVitePlugin } from 'leylines/vite'

export default defineConfig({
  plugins: [
    scopedLogsVitePlugin({
      path: '.leylines/logs.sqlite',
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

Application code can also use the browser logger directly:

```ts
import { createBrowserLogger } from 'leylines/browser'

const logger = createBrowserLogger({
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
  path: '.leylines/logs.sqlite',
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
`logs.expand(id)` or `leylines expand`.

## Agent Workflow

Start broad, discover scopes, then pivot through structured properties:

```sh
leylines --limit 30
leylines scopes
leylines --scope-prefix checkout --json
leylines --property request.id=req-123 --json
```

Agents should use JSON output for automation instead of inspecting SQLite files
directly. Store schema and file layout are internal implementation details.
