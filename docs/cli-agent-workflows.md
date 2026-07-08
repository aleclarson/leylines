# CLI And Agent Workflows

> Investigate a local Leylines store from the terminal, using compact output for
> reading and JSON output for automation or exact fields.

When no subcommand is provided, `ley` runs the recent timeline view.

Print the active inferred store path before investigating an unfamiliar
workspace:

```sh
ley path
```

## Recent Timeline

```sh
ley --limit 30
ley --scope-prefix checkout --min-level warn
ley --text payment --include-debug
```

Default output is compact and chronological. `debug` entries are hidden unless
requested with `--include-debug`, `--level debug`, or an explicit level list.

The default recent timeline returns at most 50 entries when `--limit` is not
provided.

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

JSON recent output has an `entries` array:

```json
{
  "entries": []
}
```

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

Property values are parsed as JSON when possible, so these filters are
different:

```sh
ley --property attempt=2
ley --property attempt='"2"'
```

The first matches the number `2`; the second matches the string `"2"`.

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
