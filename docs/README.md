# Leylines Docs

> Choose the right Leylines surface for a local logging workflow, then follow
> the page that owns that task or concept.

Leylines has three main entry points:

- the Node API, for writing and querying local stores from application code
- the `ley` CLI, for inspecting the same stores from a terminal or agent
- the Vite/browser integration, for collecting browser-side development events

Start with [Getting Started](./getting-started.md) when you want to write and
inspect the first local entries end to end.

## Choose A Guide

| Page | Use It When | Result |
| --- | --- | --- |
| [Getting Started](./getting-started.md) | You want the first Node, CLI, and Vite flow. | A local store contains entries you can query with `ley`. |
| [Concepts](./concepts.md) | You need the data model before choosing scopes or properties. | You know what stores, entries, scopes, metadata, properties, redaction, retention, and collapsed values mean. |
| [Node API](./node-api.md) | Application code, scripts, services, or tests need direct store access. | Code writes scoped entries, queries them, tails new entries, and expands large values. |
| [Vite And Browser](./vite-browser.md) | Browser development events should land in the local Leylines store. | Vite serve mode captures browser logs without changing production builds by default. |
| [CLI And Agent Workflows](./cli-agent-workflows.md) | A human or coding agent needs to investigate an existing store. | The investigation moves from recent entries to scopes, properties, JSON output, and expansion. |
| [PostHog Development Capture](./integrations/posthog-development.md) | Local PostHog browser events should be inspectable without being forwarded. | Product events are written as Leylines entries under the configured PostHog scope. |

## Source Of Truth

Public TSDoc owns exact API behavior. These guides own usage flow, concepts,
and API-selection guidance. Generated declarations own exact signatures.

The GitHub Pages workflow builds this folder with lildocs:

```sh
pnpm exec lildocs deploy ./docs --out dist --base /leylines/
```
