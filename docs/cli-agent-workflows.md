# CLI And Agent Workflows

Use the CLI when a human or coding agent needs to inspect a local Leylines
store without writing application code.

When no subcommand is provided, `ley` runs the recent timeline view.

## Recent Timeline

```sh
ley --limit 30
ley --scope-prefix checkout --min-level warn
ley --text payment --include-debug
```

Default output is compact and chronological. `debug` entries are hidden unless
requested with `--include-debug`, `--level debug`, or an explicit level list.

## Choosing Output Format

Use compact default output when a human or agent is reading results as context:

```sh
ley --scope-prefix checkout --property request.id=req-123
```

Use `--json` when output will be parsed, stored, compared, or when exact entry
fields such as ids, sequences, and metadata are needed:

```sh
ley --scope-prefix checkout --property request.id=req-123 --json
```

JSON output is the stable automation contract. Human-readable output may evolve
to stay compact.

## Discover Scopes

```sh
ley scopes
ley scopes --json
```

Start with scopes when you do not know which part of an application emitted the
relevant events.

## Pivot Through Properties

Structured properties are the main way to correlate entries:

```sh
ley --property request.id=req-123
ley --property cartId=cart-1
```

Property paths may use dotted notation for nested values.

## Expand Large Values

Default entries may collapse large payloads. Expand them by id:

```sh
ley expand '<entry-id>:properties.payload'
ley expand '<entry-id>:properties.payload' --json
```

## Recommended Investigation Loop

```sh
ley --limit 30
ley scopes
ley --scope-prefix checkout
ley --property request.id=req-123 --json
ley expand '<collapsed-value-id>' --json
```

Do not inspect SQLite files directly in agent workflows. The CLI and Node API
are the compatibility surfaces.
