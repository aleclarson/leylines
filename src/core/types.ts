/** Severity assigned to a log entry. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** JSON scalar value accepted by Leylines metadata and properties. */
export type JsonPrimitive = string | number | boolean | null

/** JSON-compatible value accepted by Leylines metadata and properties. */
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }

/** JSON object used for structured metadata and queryable properties. */
export type JsonObject = { [key: string]: JsonValue }

/** Normalized error details stored with an error-level or error-bearing entry. */
export interface ErrorDetails {
  /** Error class or constructor name when available. */
  name?: string
  /** Human-readable error message. */
  message: string
  /** Stack trace when available and safe to persist. */
  stack?: string
  /** JSON-compatible representation of the error cause when present. */
  cause?: JsonValue
}

/** Persisted log entry returned from writes, queries, and tails. */
export interface LogEntry {
  /** Stable unique identifier for this entry. */
  id: string
  /** Monotonic store-local sequence used to make ordering deterministic. */
  sequence: number
  /** ISO timestamp for when the entry occurred. */
  timestamp: string
  /** Entry severity. */
  level: LogLevel
  /** Dotted domain scope that produced the entry. */
  scope: string
  /** Short human-readable event message. */
  message: string
  /** Runtime context that is useful for display but not the primary query model. */
  metadata: JsonObject
  /** Structured event properties intended for filtering and correlation. */
  properties: JsonObject
  /** Normalized error details when an error was attached. */
  error?: ErrorDetails
}

/** Input accepted by store-level append operations. */
export interface LogEntryInput {
  /** Optional caller-provided entry identifier. A generated UUID is used when omitted. */
  id?: string
  /** Optional occurrence time. The current time is used when omitted. */
  timestamp?: Date | string
  /** Entry severity. */
  level: LogLevel
  /** Dotted domain scope that produced the entry. */
  scope: string
  /** Short human-readable event message. */
  message: string
  /** Runtime context that is useful for display but not the primary query model. */
  metadata?: JsonObject
  /** Structured event properties intended for filtering and correlation. */
  properties?: JsonObject
  /** Error-like value to normalize and persist with the entry. */
  error?: unknown
}

/** Equality filter against a top-level or dotted path inside entry properties. */
export interface PropertyFilter {
  /** Property name or dotted path such as `request.id`. */
  path: string
  /** JSON value that must equal the value at `path`. */
  equals: JsonValue
}

/** Query criteria shared by the Node API and CLI. */
export interface LogQuery {
  /** Include entries at or after this timestamp. */
  since?: Date | string
  /** Include entries at or before this timestamp. */
  until?: Date | string
  /** Return entries that sort before this entry id. */
  before?: string
  /** Return entries that sort after this entry id. */
  after?: string
  /** Exact levels to include. */
  levels?: LogLevel[]
  /** Include entries at this severity or higher. */
  minLevel?: LogLevel
  /** Exact scope to include. */
  scope?: string
  /** Scope prefix to include, matching both the prefix itself and dotted children. */
  scopePrefix?: string
  /** Case-sensitive message substring filter. */
  text?: string
  /** Regular expression tested against entry messages. */
  regex?: string | RegExp
  /** Equality filters over structured properties. */
  properties?: PropertyFilter[]
  /** Include debug entries, which are hidden by default. */
  includeDebug?: boolean
  /** Maximum number of entries to return. */
  limit?: number
}

/** Page of query results with stable entry-id cursors. */
export interface LogPage {
  /** Entries matched by the query in chronological order. */
  entries: LogEntry[]
  /** Cursor for entries before the first returned entry. */
  nextBefore?: string
  /** Cursor for entries after the last returned entry. */
  nextAfter?: string
}

/** Retention policy applied during store maintenance. */
export interface RetentionOptions {
  /** Maximum number of newest entries to retain. */
  maxEntries?: number
  /** Maximum entry age in milliseconds. */
  maxAgeMs?: number
}

/** Rule that replaces sensitive property names or string values before persistence. */
export interface RedactionRule {
  /** Property name or name pattern to redact. */
  name?: string | RegExp
  /** String value or value pattern to redact. */
  value?: string | RegExp
  /** Replacement text. Defaults to `[REDACTED]`. */
  replacement?: string
}

/** Redaction configuration applied before entries are persisted. */
export interface RedactionOptions {
  /** Additional rules appended to Leylines' built-in secret-looking defaults. */
  rules?: RedactionRule[]
}

/** Stored value that was collapsed out of a default entry payload. */
export interface CollapsedValue {
  /** Stable identifier used with `expand`. */
  id: string
  /** Entry id that owns the collapsed value. */
  entryId: string
  /** Path inside the entry where the value was collapsed. */
  path: string
  /** Full JSON-compatible collapsed value. */
  value: JsonValue
}
