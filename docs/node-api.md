# Node API

> Use the high-level Node API when code needs to write, query, tail, and expand
> a local Leylines store directly.

## Open A Store

```ts
import { openScopedLogs } from 'leylines'

const logs = openScopedLogs()
```

Leylines writes to the inferred local store at `.leylines/logs.sqlite` under the
current working directory.

Leylines is development-only by default. When `NODE_ENV` is `production`,
`openScopedLogs()` returns a disabled handle: it does not create a database,
writes return `undefined`, and queries return no entries. Check `logs.enabled`
when application behavior depends on whether an entry was persisted.

Enable production logging only when it is intentional:

```ts
const logs = openScopedLogs({ production: true })
```

Close the handle when the process no longer needs it:

```ts
logs.close()
```

Use an explicit path when a script or test needs an isolated store:

```ts
const logs = openScopedLogs({ path: '.leylines/test.sqlite' })
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

The second entry above has `queue=email`, `jobId=job-1`, and normalized error
details.

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

If the child scope is already fully qualified, Leylines keeps it stable:

```ts
root.child({ scope: 'checkout.payment' }).info('captured')
```

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

Default queries return up to 50 entries. `limit` is clamped between 1 and 1000.

## Tail New Entries

```ts
const controller = new AbortController()

for await (
  const entry of logs.tail({ scopePrefix: 'worker' }, { signal: controller.signal })
) {
  console.log(entry.message)
}
```

`tail` only yields entries appended after subscription.

Abort the signal when the watcher should stop:

```ts
controller.abort()
```

## Expand Collapsed Values

When large values are collapsed, query results contain collapsed identifiers.
Retrieve the full value with:

```ts
const value = logs.expand('<entry-id>:properties.payload')
```

`expand` returns `undefined` when the collapsed value is no longer present, for
example after retention has removed the owning entry.
