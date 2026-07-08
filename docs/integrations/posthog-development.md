# PostHog Development Capture

> Redirect local PostHog browser events into Leylines during development without
> forwarding those payloads to PostHog.

Leylines can redirect local PostHog browser product analytics into the same
development log store used by browser and Node logs. This is useful when agents
or developers need to inspect product events without sending them to PostHog
during local development.

Leylines does not forward redirected PostHog payloads.

## Configure Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { leylines } from 'leylines/vite'

export default defineConfig({
  plugins: [
    leylines({
      posthog: true,
    }),
  ],
})
```

`posthog: true` registers `/__leylines/posthog` and writes entries with scope
`posthog`.

Use a custom local endpoint or scope when needed:

```ts
leylines({
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
  advanced_disable_flags: import.meta.env.DEV,
})
```

Keep production PostHog configuration separate so production analytics use the
real PostHog host. `advanced_disable_flags: import.meta.env.DEV` keeps the
browser SDK from fetching remote flag/configuration data during development;
the Leylines `/__leylines/posthog` endpoint only captures PostHog event payloads
and does not implement PostHog's remote configuration endpoints.

In a Vite app, gate the local host by mode and keep the production host in the
same place as the rest of the app's environment-specific configuration:

```ts
const apiHost = import.meta.env.DEV ? '/__leylines/posthog' : productionPostHogHost

posthog.init(projectKey, {
  api_host: apiHost,
  advanced_disable_flags: import.meta.env.DEV,
})
```

## Entry Mapping

Each captured PostHog event becomes a Leylines entry:

- `scope`: configured PostHog scope, default `posthog`
- `message`: PostHog event name
- `metadata.source`: `posthog`
- `metadata.posthogEndpoint`: configured local ingestion endpoint
- `metadata.posthogRequestUrl`: request URL received by the Vite middleware
- `metadata.browserUrl`: PostHog `$current_url` when present
- `metadata.viteMode`: Vite mode
- `metadata.viteCommand`: Vite command
- `properties.event`: PostHog event name
- `properties.distinctId`: distinct id when present
- `properties.properties`: event properties
- `properties.payload`: normalized original event object

Redaction runs through the normal Leylines store path before persistence.

```json
{
  "scope": "posthog",
  "message": "signup_clicked",
  "metadata": {
    "source": "posthog",
    "posthogEndpoint": "/__leylines/posthog",
    "posthogRequestUrl": "/__leylines/posthog",
    "browserUrl": "http://localhost/signup"
  },
  "properties": {
    "event": "signup_clicked",
    "distinctId": "user-1",
    "properties": {
      "plan": "pro"
    }
  }
}
```

## Inspect Product Events

```sh
ley --scope posthog
ley --scope posthog --property event=signup_clicked --json
```

Because event names are arbitrary product data, Leylines keeps them in
`message` and `properties.event` instead of converting them into scopes.
