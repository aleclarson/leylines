# Concepts

> Use these concepts to choose stable scopes, decide what belongs in properties
> versus metadata, and understand what Leylines stores before you query it.

Leylines models local runtime activity as scoped, structured log entries in a
durable store.

## Store

A store is a local SQLite-backed timeline. It owns persistence, retention,
redaction, query behavior, collapsed values, and tail subscriptions.

Users should interact with stores through the Node API, Vite plugin, or CLI.
The database schema and file layout are internal details.

```ts
import { openScopedLogs } from 'leylines'

const logs = openScopedLogs({
  path: '.leylines/logs.sqlite',
})

logs.close()
```

When `path` is omitted, Leylines uses `.leylines/logs.sqlite` under the current
working directory and keeps that default folder out of Git through the local
exclude file when possible.

## Entry

An entry is immutable after it is written. It contains:

- `id`: stable entry identifier.
- `sequence`: store-local monotonic order.
- `timestamp`: ISO occurrence time.
- `level`: `debug`, `info`, `warn`, or `error`.
- `scope`: dotted domain scope.
- `message`: short event text.
- `metadata`: runtime context.
- `properties`: structured, queryable event data.
- `error`: optional normalized error details.

Prefer short messages and put correlation values in `properties`.

```json
{
  "level": "info",
  "scope": "checkout.cart",
  "message": "item added",
  "metadata": { "runtime": "node" },
  "properties": { "cartId": "cart-1", "sku": "sku-123" }
}
```

## Scope

Scopes identify the product concept or workflow that emitted an entry. They are
query boundaries, not display tags.

Good scopes:

```txt
checkout.cart
auth.session
worker.queue
browser.router
posthog
```

Use child loggers when a workflow naturally nests:

```ts
const logger = logs.logger('checkout')
const cartLogger = logger.child({ scope: 'cart' })

cartLogger.info('opened')
```

The child entry scope is `checkout.cart`.

Use `scopePrefix` when a workflow owns nested scopes:

```ts
const page = logs.query({ scopePrefix: 'checkout' })
```

This matches both `checkout` and dotted children such as `checkout.cart`.

## Metadata Versus Properties

Use `metadata` for runtime context such as browser URL, Vite mode, process id,
or user agent. Use `properties` for values you expect to filter, correlate, or
pivot on during investigation.

Examples of properties:

- `request.id`
- `cartId`
- `projectId`
- `operation`
- `attempt`

```ts
logger.info('request finished', {
  metadata: {
    runtime: 'node',
    pid: process.pid,
  },
  properties: {
    request: { id: 'req-123' },
    operation: 'checkout.submit',
  },
})
```

Query filters only target `properties`, so a value such as `request.id` belongs
there when an investigation will pivot on it:

```sh
ley --property request.id=req-123 --json
```

## Debug Entries

`debug` entries are hidden from default queries and CLI output. Request them
explicitly with `includeDebug`, `levels: ['debug']`, or `--include-debug`.

This keeps routine investigation output compact while preserving debug detail
for focused queries.

```ts
logger.debug('payment gateway response', {
  properties: { request: { id: 'req-123' } },
})

const entries = logs.query({
  scopePrefix: 'checkout',
  includeDebug: true,
}).entries
```

## Redaction

Redaction runs before persistence. Leylines redacts common secret-looking
property names and values by default, and callers may add project-specific
rules.

Redaction preserves diagnostic shape. An entry can still show that a token-like
field existed without storing its raw value.

```ts
const logs = openScopedLogs({
  redaction: {
    rules: [{ name: /apiToken/i }],
  },
})
const logger = logs.logger('checkout')

logger.info('provider configured', {
  properties: {
    provider: 'stripe',
    apiToken: 'sk_test_secret',
  },
})

const entry = logs.query({ scopePrefix: 'checkout' }).entries[0]
console.log(entry.properties.apiToken) // [REDACTED]
```

## Retention

Retention is applied when a store opens, when it closes, and periodically during
writes. Use it to keep local stores bounded by entry count, age, or both without
paying retention cost on every entry.

```ts
openScopedLogs({
  retention: {
    maxEntries: 10_000,
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  },
})
```

When both limits are configured, entries must survive both checks: old entries
are removed by age, and only the newest `maxEntries` entries remain.

Retention deletes rows and lets SQLite reuse freed pages. Leylines also
checkpoint-truncates the SQLite WAL file when a store opens and closes, but it
does not run `VACUUM` automatically.

## Collapsed Values

Large JSON values are collapsed out of default entries and can be expanded by
id later. This keeps timelines compact while retaining full diagnostic payloads
when needed.

Use `logs.expand(id)` or `ley expand <id>`.

```ts
const page = logs.query({ scopePrefix: 'worker' })
const entry = page.entries[0]

// Query results keep the entry id and collapsed path separate.
const payload = logs.expand(`${entry.id}:properties.payload`)
console.log(payload?.value)
```

From the CLI, pass the entry id plus the collapsed path:

```sh
ley expand '<entry-id>:properties.payload' --json
```
