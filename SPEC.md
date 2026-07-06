# Scoped Logs Spec

Scoped Logs is a small, reusable logging package for applications and agents that need durable, queryable event timelines without adopting a full observability stack.

The package preserves the core idea behind Goddard's domain logs: logs are structured records, belong to explicit scopes, carry safe queryable properties, and can be inspected by humans or agents after the fact.

## Product Shape

Scoped Logs ships as one package family with three surfaces:

- A Vite plugin that captures browser-side logs from web applications during development and supported local runtimes.
- A Node.js library that writes, tails, and queries logs from Node.js processes.
- A Node.js-powered CLI that exposes the same log store to humans and coding agents.

The surfaces share one data model and one query model. The Vite plugin and CLI must not invent behavior that the Node.js library cannot express.

## Core Concepts

### Log Store

A log store is a local durable timeline of structured log entries.

A store must support append-only writes, stable ordering, pagination, bounded retention, and efficient queries over time, scope, level, message text, and structured properties.

A store may be file-backed or database-backed, but storage details are not part of the public contract. Users interact with store locations, not storage internals.

### Entry

Each log entry records:

- A stable entry identifier.
- Timestamp.
- Level.
- Scope.
- Message.
- Process/runtime metadata when available.
- Structured properties.
- Optional error details.

Entries are immutable once written. Redaction and normalization happen before persistence.

### Scope

A scope names the domain that produced the entry. Scopes are stable, dotted identifiers such as `app.router`, `auth.session`, or `worker.queue`.

Scopes are query boundaries, not only display labels. Users and agents must be able to filter by exact scope or scope prefix.

The package distinguishes product/domain scopes from runtime metadata. For example, `checkout.cart` is a scope; `pid`, `hostname`, and `browserUrl` are metadata.

### Level

The supported levels are `debug`, `info`, `warn`, and `error`.

Default human views hide `debug` entries unless the user opts into them globally or by scope prefix. Machine-readable queries may request any level explicitly.

### Structured Properties

Entries may carry JSON-compatible properties. Properties are first-class query inputs.

The package must support equality filtering on top-level property names and dotted paths inside object properties. It must preserve enough property structure for agents to pivot from one observed value, such as a request ID or session ID, to related entries.

Large values may be collapsed in human output while remaining retrievable through an explicit expansion command or API.

### Redaction

Sensitive values must be redacted before persistence. Redaction applies consistently across the Vite plugin, Node.js library, and CLI ingestion paths.

The package must provide safe defaults for common secret-looking names and values. Users may add project-specific redaction rules.

Redaction must prefer preserving diagnostic shape over preserving raw values: an entry should still reveal that a token, header, or credential-like field existed, without exposing the secret.

## Vite Plugin

The Vite plugin captures browser-side logs and sends them to a local Scoped Logs store during supported local development and test-like runtimes.

The plugin must support:

- Installing a browser logger with the same scope, level, message, and properties model as the Node.js library.
- Capturing selected console calls when enabled.
- Capturing uncaught errors and unhandled promise rejections when enabled.
- Associating browser entries with useful runtime metadata such as page URL, user agent, Vite mode, and client session identity when available.
- Sending entries to a local ingestion endpoint controlled by the plugin runtime.
- Applying redaction before entries are persisted.

The plugin must not require application code to depend on Vite-specific APIs to write scoped logs. Application code should be able to use the shared logger API and run under other supported runtimes.

The plugin must be quiet by default in production builds. Any production capture path must be explicit.

## Node.js Library

The Node.js library is the canonical API surface.

It must support:

- Opening or creating a log store.
- Creating scoped loggers.
- Writing entries at all supported levels.
- Attaching default properties to a logger or child logger.
- Querying entries with the shared query model.
- Tailing entries as they are appended.
- Expanding collapsed values.
- Configuring retention and redaction.
- Closing resources cleanly.

The public API should stay minimal. Convenience helpers are acceptable only when they preserve the same concepts as the core writer, query, tail, and expansion operations.

The library must be usable from ordinary Node.js scripts, long-running services, and CLI tools.

## CLI

The CLI is optimized for agent and operator workflows over the local log store.

It must support:

- Printing recent entries as a readable timeline.
- Tailing new entries.
- Listing observed scopes.
- Filtering by time range, entry boundary, level, scope, scope prefix, message text, regular expression, and structured property.
- Emitting JSON for machine consumption.
- Expanding collapsed property values by identifier.
- Printing the active store path.

Default output must be compact and stable enough for agents to parse reliably. JSON output is the compatibility contract for automation.

The CLI must make focused investigation easy: a user or agent should be able to start with recent logs, discover scopes, filter to a scope prefix, find a correlation property, and pivot to related entries without leaving the CLI.

## Query Model

All surfaces share one query model:

- Time filters: since, until, before entry, after entry.
- Level filters: exact levels and minimum level where useful.
- Scope filters: exact scope and scope prefix.
- Text filters: plain substring and regular expression.
- Property filters: equality on top-level properties and dotted property paths.
- Pagination: limit plus stable before/after cursors.
- Output modes: human timeline and structured JSON where applicable.

Queries must be deterministic for a fixed store state. Pagination must not skip or duplicate entries when entries share timestamps.

## Agent Use

Scoped Logs is designed for coding agents that need compact, queryable runtime context.

The package must optimize for:

- Stable commands and JSON fields.
- Short default output.
- Discoverable scopes.
- Correlation through structured properties.
- Safe handling of secrets.
- Clear absence states when no entries match.

Agent workflows should not require direct store inspection or knowledge of storage internals.

## Where This Beats `tee`

A Vite plugin that forwards browser console output to the dev server and a shell `tee` that writes those logs to a file is a valid simpler baseline. Scoped Logs must justify its extra surface area by providing capabilities that plain log files do not reliably provide.

Scoped Logs is better than `tee` when users or agents need:

- Structured filtering by scope, level, time, entry boundary, and property path rather than text-only `grep`.
- Stable domain scopes that can be discovered and queried as first-class investigation handles.
- Correlation across entries through structured values such as request IDs, session IDs, route names, or operation IDs.
- Redaction before persistence instead of trusting every stdout line to be safe to keep.
- Bounded retention and stable pagination instead of unbounded files, ad hoc truncation, or log rotation conventions.
- Compact default output that hides debug noise while still allowing focused debug-scope queries.
- Machine-readable JSON output with stable fields for agent automation.
- Expansion of large collapsed values without flooding the default timeline.
- A shared browser, Node.js, and CLI model rather than conventions embedded in log formatting.

A disciplined JSONL file produced through `tee` can cover early development needs when the only requirement is that an agent can read recent logs. Scoped Logs should not replace that baseline unless the workflow needs durable querying, safe persistence, structured correlation, or stable agent commands.

## Boundaries

Scoped Logs is not a metrics system, distributed tracing backend, crash reporter, or hosted log aggregation service.

It may interoperate with those systems, but its contract is local scoped event capture and query.

The package must avoid broad framework coupling. Vite is one integration surface, not the core abstraction.

The package must avoid unbounded retention by default. Users need predictable local disk behavior.

## Compatibility Expectations

The data model and query model are shared across all package surfaces.

Changes that alter stored entry meaning, query semantics, redaction behavior, or JSON CLI output are compatibility-sensitive.

Human-readable output may evolve, but it must remain concise, chronological by default, and suitable for interactive debugging.
