# Concepts

Leylines models local runtime activity as scoped, structured log entries in a
durable store.

## Store

A store is a local SQLite-backed timeline. It owns persistence, retention,
redaction, query behavior, collapsed values, and tail subscriptions.

Users should interact with stores through the Node API, Vite plugin, or CLI.
The database schema and file layout are internal details.

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

## Debug Entries

`debug` entries are hidden from default queries and CLI output. Request them
explicitly with `includeDebug`, `levels: ['debug']`, or `--include-debug`.

This keeps routine investigation output compact while preserving debug detail
for focused queries.

## Redaction

Redaction runs before persistence. Leylines redacts common secret-looking
property names and values by default, and callers may add project-specific
rules.

Redaction preserves diagnostic shape. An entry can still show that a token-like
field existed without storing its raw value.

## Retention

Retention is applied after each write. Use it to keep local stores bounded by
entry count, age, or both.

```ts
openScopedLogs({
  retention: {
    maxEntries: 10_000,
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  },
})
```

## Collapsed Values

Large JSON values are collapsed out of default entries and can be expanded by
id later. This keeps timelines compact while retaining full diagnostic payloads
when needed.

Use `logs.expand(id)` or `ley expand <id>`.
