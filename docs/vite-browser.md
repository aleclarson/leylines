# Vite And Browser

Use the Vite plugin to collect browser-side development logs into the same
local store used by the Node API and CLI.

## Configure The Plugin

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { scopedLogsVitePlugin } from 'leylines/vite'

export default defineConfig({
  plugins: [
    scopedLogsVitePlugin({
      path: '.leylines/logs.sqlite',
      endpoint: '/__scoped_logs',
      scope: 'browser',
      captureConsole: ['warn', 'error'],
      captureErrors: true,
      captureRejections: true,
    }),
  ],
})
```

In serve mode, the plugin:

- opens the configured local store
- registers a browser log ingestion endpoint
- injects `logger.connect(...)` into HTML
- optionally captures console calls, uncaught errors, and unhandled rejections

Production build capture is disabled by default. Use `production: true` only
when production browser capture is intentional.

## Write Browser Entries

```ts
import { logger } from 'leylines/browser'

logger.info('route loaded', { route: '/settings' })
logger.child({ scope: 'checkout' }).warn('submit retrying', {
  attempt: 2,
})
```

The exported `logger` is a side-effect-free singleton. Importing it does not
patch console methods, add event listeners, or send network requests. The Vite
plugin connects it during page load.

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
scopedLogsVitePlugin({
  captureConsole: ['warn', 'error'],
})
```

Captured console entries are still written to the original console method, then
sent to Leylines with `properties.console: true`.

## Error Capture

`captureErrors` records uncaught browser errors. `captureRejections` records
unhandled promise rejections. Both default to `true` for the injected browser
logger.

## Inspect Browser Logs

```sh
ley --store .leylines/logs.sqlite --scope-prefix browser
ley --store .leylines/logs.sqlite --scope-prefix browser --json
```
