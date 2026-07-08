# Vite And Browser

> Use the Vite integration when browser-side development events should be
> captured in the same local store as Node and CLI entries.

Use the Vite plugin to collect browser-side development logs into the same
local store used by the Node API and CLI.

## Configure The Plugin

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { leylines } from 'leylines/vite'

export default defineConfig({
  plugins: [
    leylines({
      endpoint: '/__scoped_logs',
      scope: 'browser',
      captureConsole: ['warn', 'error'],
      captureErrors: true,
      captureRejections: true,
      stripProduction: true,
    }),
  ],
})
```

In serve mode, the plugin:

- opens the inferred local store
- registers a browser log ingestion endpoint
- injects `logger.connect(...)` into HTML
- optionally captures console calls, uncaught errors, and unhandled rejections

Production build capture is disabled by default. Use `production: true` only
when production browser capture is intentional.

```ts
leylines({
  production: true,
  captureConsole: ['error'],
})
```

The default endpoint is `/__scoped_logs`, and the default browser scope is
`browser`.

Use `stripProduction: true` when application logger calls should be removed from
production modules:

```ts
leylines({
  stripProduction: true,
})
```

The source rewriter removes standalone browser logger calls after static
`leylines/browser` imports:

```ts
import { logger } from 'leylines/browser'

logger.info('router', 'route loaded')
logger.warn('checkout', 'submit retrying', { attempt: 2 })
```

Remaining logger references are replaced with a local no-op logger so unusual
usage still builds without sending entries.

## Vite Logger Capture

Capture Vite's own dev-server warnings and errors when agents need structured
diagnostics instead of terminal output:

```ts
leylines({
  viteLogger: {
    scope: 'dev.vite',
    levels: ['warn', 'error'],
  },
})
```

Captured entries keep Vite mode, command, logger method, and Rollup/Vite error
context such as plugin name, hook, module id, source location, frame, and stack
when Vite provides them. Terminal output still goes through Vite's normal
logger.

```sh
ley --scope-prefix dev.vite --min-level warn --json
```

For the default `dev.vite` scope, `captureViteLogger` is a shorthand:

```ts
leylines({
  captureViteLogger: ['warn', 'error'],
})
```

## Write Browser Entries

```ts
import { logger } from 'leylines/browser'

logger.info('router', 'route loaded', { route: '/settings' })
logger.warn('checkout', 'submit retrying', {
  attempt: 2,
})
```

The exported `logger` is a side-effect-free singleton. Importing it does not
patch console methods, add event listeners, or send network requests. The Vite
plugin connects it during page load.

Before connection, logger writes are ignored. After the Vite plugin injects
`logger.connect(...)`, browser entries are posted to the configured endpoint.
The first argument is the entry scope, and the second argument is the event
message. Keep scopes stable around the product area or component, such as
`router` or `checkout.payment`; put the event action in the message.

## Tauri Log Forwarding

Install Tauri's log plugin in apps that should forward native-side records into
the Vite plugin's local ingestion endpoint:

```sh
pnpm add @tauri-apps/plugin-log
```

Then attach forwarding from app startup code:

```ts
import { attachTauriLogger } from 'leylines/tauri'

const detachTauriLogs = attachTauriLogger({
  scope: 'tauri',
  metadata: { windowLabel: 'main' },
})
```

The Vite plugin connects `leylines/browser` before application modules run, so
Tauri records sent through `attachTauriLogger` are posted to the same
`/__scoped_logs` endpoint as browser entries. The default scope is `tauri`, and
each entry includes `properties.source: 'tauri.log'`.

Call the returned function when forwarding should stop:

```ts
detachTauriLogs()
```

## Manual Connection

For non-Vite browser runtimes, connect the singleton explicitly:

```ts
import { logger } from 'leylines/browser'

logger.connect({
  endpoint: '/__scoped_logs',
  scope: 'browser',
  captureConsole: false,
  captureErrors: true,
  captureRejections: true,
})
```

Repeated `connect` calls reconfigure the singleton without stacking duplicate
console or error capture hooks.

## Console Capture

`captureConsole` accepts `true` or selected levels:

```ts
leylines({
  captureConsole: ['warn', 'error'],
})
```

Captured console entries are still written to the original console method, then
sent to Leylines with `properties.console: true`.

## Error Capture

`captureErrors` records uncaught browser errors. `captureRejections` records
unhandled promise rejections. Both default to `true` for the injected browser
logger.

```ts
leylines({
  captureErrors: true,
  captureRejections: true,
})
```

## Inspect Browser Logs

```sh
ley --scope router
ley --scope-prefix browser
```

Use the Vite logger scope separately when you enabled Vite logger capture:

```sh
ley --scope-prefix dev.vite --min-level warn --json
```
