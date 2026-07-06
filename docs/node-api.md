# Node API

Use the Node API when application code, scripts, services, or tests need to
write and query a local Leylines store directly.

## Open A Store

```ts
import { openScopedLogs } from 'leylines'

const logs = openScopedLogs()
```

Leylines writes to the inferred local store.

Close the handle when the process no longer needs it:

```ts
logs.close()
```

## Write Scoped Entries

```ts
const logger = logs.logger({
  scope: 'worker.queue',
  properties: { queue: 'email' },
  metadata: { runtime: 'node' },
})

logger.info('job started', {
  properties: { jobId: 'job-1', attempt: 1 },
})

logger.error('job failed', {
  properties: { jobId: 'job-1' },
  error: new Error('smtp unavailable'),
})
```

Logger properties and metadata are inherited by every entry. Per-entry values
merge over inherited values.

## Use Child Loggers

Child loggers keep related workflow context close to the code that emits it:

```ts
const root = logs.logger('checkout')
const payment = root.child({
  scope: 'payment',
  properties: { provider: 'stripe' },
})

payment.warn('authorization retrying', {
  properties: { attempt: 2 },
})
```

The entry scope is `checkout.payment`.

## Query Entries

```ts
const page = logs.query({
  scopePrefix: 'checkout',
  minLevel: 'warn',
  properties: [{ path: 'request.id', equals: 'req-123' }],
  limit: 50,
})

for (const entry of page.entries) {
  console.log(entry.timestamp, entry.level, entry.scope, entry.message)
}
```

Queries are chronological and deterministic. Use `before` and `after` cursors
for pagination.

## Tail New Entries

```ts
const controller = new AbortController()

for await (const entry of logs.tail({ scopePrefix: 'worker' }, { signal: controller.signal })) {
  console.log(entry.message)
}
```

`tail` only yields entries appended after subscription.

## Expand Collapsed Values

When large values are collapsed, query results contain collapsed identifiers.
Retrieve the full value with:

```ts
const value = logs.expand('<entry-id>:properties.payload')
```
