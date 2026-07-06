# PostHog Development Capture

Leylines can redirect local PostHog browser product analytics into the same
development log store used by browser and Node logs. This is useful when agents
or developers need to inspect product events without sending them to PostHog
during local development.

Leylines does not forward redirected PostHog payloads.

## Configure Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { scopedLogsVitePlugin } from 'leylines/vite'

export default defineConfig({
  plugins: [
    scopedLogsVitePlugin({
      path: '.leylines/logs.sqlite',
      posthog: true,
    }),
  ],
})
```

`posthog: true` registers `/__leylines/posthog` and writes entries with scope
`posthog`.

Use a custom local endpoint or scope when needed:

```ts
scopedLogsVitePlugin({
  posthog: {
    endpoint: '/analytics',
    scope: 'metrics.product',
  },
})
```

## Configure PostHog

Point PostHog's browser SDK at the local endpoint during development:

```ts
posthog.init(projectKey, {
  api_host: '/__leylines/posthog',
})
```

Keep production PostHog configuration separate so production analytics use the
real PostHog host.

## Entry Mapping

Each captured PostHog event becomes a Leylines entry:

- `scope`: configured PostHog scope, default `posthog`
- `message`: PostHog event name
- `metadata.source`: `posthog`
- `metadata.browserUrl`: PostHog `$current_url` when present
- `properties.event`: PostHog event name
- `properties.distinctId`: distinct id when present
- `properties.properties`: event properties
- `properties.payload`: normalized original event object

Redaction runs through the normal Leylines store path before persistence.

## Inspect Product Events

```sh
ley --store .leylines/logs.sqlite --scope posthog
ley --store .leylines/logs.sqlite --scope posthog --property event=signup_clicked --json
```

Because event names are arbitrary product data, Leylines keeps them in
`message` and `properties.event` instead of converting them into scopes.
