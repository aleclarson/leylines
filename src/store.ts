import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { EventEmitter, on } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import { normalizeEntry } from './entry.js'
import { matchesQuery, toIso } from './query.js'
import type {
  CollapsedValue,
  JsonValue,
  LogEntry,
  LogEntryInput,
  LogPage,
  LogQuery,
  RedactionOptions,
  RetentionOptions,
} from './types.js'

export interface OpenLogStoreOptions {
  path: string
  retention?: RetentionOptions
  redaction?: RedactionOptions
  collapseAboveBytes?: number
}

interface EntryRow {
  id: string
  sequence: number
  timestamp: string
  level: LogEntry['level']
  scope: string
  message: string
  metadata_json: string
  properties_json: string
  error_json: string | null
}

interface CollapsedRow {
  id: string
  entry_id: string
  path: string
  value_json: string
}

export class LogStore {
  readonly path: string

  #db: DatabaseSync
  #retention: RetentionOptions
  #redaction: RedactionOptions
  #collapseAboveBytes: number
  #events = new EventEmitter()
  #closed = false

  constructor(options: OpenLogStoreOptions) {
    this.path = resolve(options.path)
    this.#retention = options.retention ?? { maxEntries: 10_000 }
    this.#redaction = options.redaction ?? {}
    this.#collapseAboveBytes = options.collapseAboveBytes ?? 8_192

    mkdirSync(dirname(this.path), { recursive: true })
    this.#db = new DatabaseSync(this.path)
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS entries (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        scope TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        properties_json TEXT NOT NULL,
        error_json TEXT
      );

      CREATE INDEX IF NOT EXISTS entries_time_sequence_idx ON entries (timestamp, sequence);
      CREATE INDEX IF NOT EXISTS entries_scope_idx ON entries (scope);
      CREATE INDEX IF NOT EXISTS entries_level_idx ON entries (level);

      CREATE TABLE IF NOT EXISTS collapsed_values (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        value_json TEXT NOT NULL
      );
    `)
  }

  write(input: LogEntryInput): LogEntry {
    this.#assertOpen()
    const sequence = this.#nextSequence()
    const normalized = normalizeEntry(input, sequence, this.#redaction)
    const collapsed = new Map<string, JsonValue>()
    const entry = collapseEntry(normalized, this.#collapseAboveBytes, collapsed)

    this.#db.prepare(`
      INSERT INTO entries (sequence, id, timestamp, level, scope, message, metadata_json, properties_json, error_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.sequence,
      entry.id,
      entry.timestamp,
      entry.level,
      entry.scope,
      entry.message,
      JSON.stringify(entry.metadata),
      JSON.stringify(entry.properties),
      entry.error ? JSON.stringify(entry.error) : null,
    )

    const insertCollapsed = this.#db.prepare(`
      INSERT INTO collapsed_values (id, entry_id, path, value_json)
      VALUES (?, ?, ?, ?)
    `)
    for (const [path, value] of collapsed) {
      insertCollapsed.run(collapsedId(entry.id, path), entry.id, path, JSON.stringify(value))
    }

    this.#applyRetention()
    this.#events.emit('entry', entry)
    return entry
  }

  query(query: LogQuery = {}): LogPage {
    this.#assertOpen()
    const limit = Math.max(1, Math.min(query.limit ?? 50, 1_000))
    const candidates = this.#candidateRows(query, limit * 5)
      .map(rowToEntry)
      .filter(entry => this.#matchesEntryBoundaries(entry, query))
      .filter(entry => matchesQuery(entry, query))
      .slice(0, limit)

    return {
      entries: candidates,
      nextBefore: candidates[0]?.id,
      nextAfter: candidates.at(-1)?.id,
    }
  }

  listScopes(): string[] {
    this.#assertOpen()
    return (this.#db.prepare('SELECT DISTINCT scope FROM entries ORDER BY scope').all() as { scope: string }[]).map(row => row.scope)
  }

  expand(id: string): CollapsedValue | undefined {
    this.#assertOpen()
    const row = this.#db.prepare('SELECT id, entry_id, path, value_json FROM collapsed_values WHERE id = ?').get(id) as CollapsedRow | undefined
    if (!row) {
      return undefined
    }

    return {
      id: row.id,
      entryId: row.entry_id,
      path: row.path,
      value: JSON.parse(row.value_json) as JsonValue,
    }
  }

  async *tail(query: LogQuery = {}, options: { signal?: AbortSignal } = {}): AsyncIterable<LogEntry> {
    this.#assertOpen()
    for await (const [entry] of on(this.#events, 'entry', { signal: options.signal })) {
      const logEntry = entry as LogEntry
      if (matchesQuery(logEntry, query)) {
        yield logEntry
      }
    }
  }

  close(): void {
    if (this.#closed) {
      return
    }

    this.#db.close()
    this.#closed = true
  }

  #nextSequence(): number {
    const row = this.#db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get('entries') as { seq: number } | undefined
    return (row?.seq ?? 0) + 1
  }

  #candidateRows(query: LogQuery, limit: number): EntryRow[] {
    const clauses: string[] = []
    const values: (string | number)[] = []

    if (query.since) {
      clauses.push('timestamp >= ?')
      values.push(toIso(query.since))
    }

    if (query.until) {
      clauses.push('timestamp <= ?')
      values.push(toIso(query.until))
    }

    if (query.scope) {
      clauses.push('scope = ?')
      values.push(query.scope)
    }
    else if (query.scopePrefix) {
      clauses.push('(scope = ? OR scope LIKE ?)')
      values.push(query.scopePrefix, `${query.scopePrefix}.%`)
    }

    if (query.levels?.length) {
      clauses.push(`level IN (${query.levels.map(() => '?').join(', ')})`)
      values.push(...query.levels)
    }

    if (query.text) {
      clauses.push('message LIKE ?')
      values.push(`%${escapeLike(query.text)}%`)
    }

    const sql = `
      SELECT sequence, id, timestamp, level, scope, message, metadata_json, properties_json, error_json
      FROM entries
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY timestamp ASC, sequence ASC
      LIMIT ?
    `

    return this.#db.prepare(sql).all(...values, limit) as unknown as EntryRow[]
  }

  #matchesEntryBoundaries(entry: LogEntry, query: LogQuery): boolean {
    if (query.before) {
      const boundary = this.#entryById(query.before)
      if (boundary && compareEntryOrder(entry, boundary) >= 0) {
        return false
      }
    }

    if (query.after) {
      const boundary = this.#entryById(query.after)
      if (boundary && compareEntryOrder(entry, boundary) <= 0) {
        return false
      }
    }

    return true
  }

  #entryById(id: string): LogEntry | undefined {
    const row = this.#db.prepare(`
      SELECT sequence, id, timestamp, level, scope, message, metadata_json, properties_json, error_json
      FROM entries
      WHERE id = ?
    `).get(id) as EntryRow | undefined
    return row ? rowToEntry(row) : undefined
  }

  #applyRetention(): void {
    if (this.#retention.maxAgeMs !== undefined) {
      const cutoff = new Date(Date.now() - this.#retention.maxAgeMs).toISOString()
      this.#db.prepare('DELETE FROM entries WHERE timestamp < ?').run(cutoff)
    }

    if (this.#retention.maxEntries !== undefined) {
      this.#db.prepare(`
        DELETE FROM entries
        WHERE sequence NOT IN (
          SELECT sequence FROM entries ORDER BY timestamp DESC, sequence DESC LIMIT ?
        )
      `).run(this.#retention.maxEntries)
    }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error('Log store is closed')
    }
  }
}

export function openLogStore(options: OpenLogStoreOptions): LogStore {
  return new LogStore(options)
}

function rowToEntry(row: EntryRow): LogEntry {
  return {
    id: row.id,
    sequence: row.sequence,
    timestamp: row.timestamp,
    level: row.level,
    scope: row.scope,
    message: row.message,
    metadata: JSON.parse(row.metadata_json),
    properties: JSON.parse(row.properties_json),
    error: row.error_json ? JSON.parse(row.error_json) : undefined,
  }
}

function collapseEntry(entry: LogEntry, threshold: number, collapsed: Map<string, JsonValue>): LogEntry {
  return {
    ...entry,
    metadata: collapseObject(entry.metadata, threshold, collapsed, 'metadata'),
    properties: collapseObject(entry.properties, threshold, collapsed, 'properties'),
    error: entry.error ? collapseObject(entry.error as unknown as JsonValue, threshold, collapsed, 'error') as unknown as LogEntry['error'] : undefined,
  }
}

function collapseObject<T extends JsonValue>(value: T, threshold: number, collapsed: Map<string, JsonValue>, path: string): T {
  if (JSON.stringify(value).length <= threshold) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((child, index) => collapseValue(child, threshold, collapsed, `${path}.${index}`)) as T
  }

  if (value && typeof value === 'object') {
    const result: Record<string, JsonValue> = {}
    for (const [key, child] of Object.entries(value)) {
      result[key] = collapseValue(child, threshold, collapsed, `${path}.${key}`)
    }
    return result as T
  }

  return value
}

function collapseValue(value: JsonValue, threshold: number, collapsed: Map<string, JsonValue>, path: string): JsonValue {
  if (JSON.stringify(value).length <= threshold) {
    return collapseObject(value, threshold, collapsed, path)
  }

  collapsed.set(path, value)
  return {
    $collapsed: true,
    id: path,
    path,
    bytes: JSON.stringify(value).length,
  }
}

function collapsedId(entryId: string, path: string): string {
  return `${entryId}:${path}`
}

function compareEntryOrder(left: LogEntry, right: LogEntry): number {
  const time = left.timestamp.localeCompare(right.timestamp)
  return time === 0 ? left.sequence - right.sequence : time
}

function escapeLike(value: string): string {
  return value.replaceAll('%', '\\%').replaceAll('_', '\\_')
}
