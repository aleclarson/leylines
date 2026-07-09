import { appendFileSync, readFileSync, statSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isPlainObject } from 'radashi'
import { openLogStore, type LogStore } from './store.js'
import { toJsonObject, toJsonValue } from '../core/json.js'
import type {
  JsonObject,
  LogEntry,
  LogLevel,
  LogQuery,
  RedactionOptions,
  RetentionOptions,
} from '../core/types.js'

/** Options for opening the high-level Scoped Logs API. */
export interface OpenScopedLogsOptions {
  path?: string
  /** Enable logging when `NODE_ENV` is `production`. Disabled by default. */
  production?: boolean
  /** Retention policy applied during store maintenance. */
  retention?: RetentionOptions
  /** Redaction rules applied before entries are persisted. */
  redaction?: RedactionOptions
  /** Byte threshold above which large JSON values are collapsed for default views. */
  collapseAboveBytes?: number
}

/** Base scope and inherited context for a scoped logger. */
export interface LoggerOptions {
  /** Dotted domain scope assigned to entries from this logger. */
  scope: string
  /** Structured properties inherited by every entry from this logger. */
  properties?: JsonObject
  /** Metadata inherited by every entry from this logger. */
  metadata?: JsonObject
}

/** Per-entry options accepted by `ScopedLogger` write methods. */
export interface LoggerWriteOptions {
  /** Structured properties merged over the logger's inherited properties. */
  properties?: JsonObject
  /** Metadata merged over the logger's inherited metadata. */
  metadata?: JsonObject
  /** Error-like value to normalize and persist with the entry. */
  error?: unknown
  /** Occurrence time. The current time is used when omitted. */
  timestamp?: Date | string
}

/** High-level handle for writing, querying, tailing, and closing a log store. */
export interface ScopedLogs {
  /** Whether this handle writes to a durable store. */
  readonly enabled: boolean
  /** Underlying durable store, absent when production logging is disabled. */
  readonly store: LogStore | undefined
  /** Create a logger for a scope or full logger options. */
  logger(options: LoggerOptions | string): ScopedLogger
  /** Query stored entries. */
  query(query?: LogQuery): ReturnType<LogStore['query']>
  /** Stream entries appended after subscription that match the query. */
  tail(query?: LogQuery, options?: { signal?: AbortSignal }): AsyncIterable<LogEntry>
  /** Retrieve a full collapsed value by collapsed value id. */
  expand(id: string): ReturnType<LogStore['expand']>
  /** List scopes observed in the store. */
  listScopes(): string[]
  /** Close the underlying store. */
  close(): void
}

/** Logger that writes entries to a `LogStore` under a stable domain scope. */
export class ScopedLogger {
  /** Dotted domain scope assigned to entries from this logger. */
  readonly scope: string

  #store: LogStore | undefined
  #properties: JsonObject
  #metadata: JsonObject

  /** Create a logger backed by `store` with inherited scope, properties, and metadata. */
  constructor(store: LogStore | undefined, options: LoggerOptions) {
    this.#store = store
    this.scope = options.scope
    this.#properties = options.properties ?? {}
    this.#metadata = options.metadata ?? {}
  }

  /** Create a child logger with merged inherited context and a nested scope. */
  child(options: Partial<LoggerOptions> & { scope?: string } = {}): ScopedLogger {
    return new ScopedLogger(this.#store, {
      scope: options.scope ? joinScope(this.scope, options.scope) : this.scope,
      properties: mergeJsonObjects(this.#properties, options.properties),
      metadata: mergeJsonObjects(this.#metadata, options.metadata),
    })
  }

  /** Write a debug entry. Debug entries are hidden from default queries unless requested. */
  debug(message: string, options?: LoggerWriteOptions): LogEntry | undefined {
    return this.write('debug', message, options)
  }

  /** Write an info entry. */
  info(message: string, options?: LoggerWriteOptions): LogEntry | undefined {
    return this.write('info', message, options)
  }

  /** Write a warning entry. */
  warn(message: string, options?: LoggerWriteOptions): LogEntry | undefined {
    return this.write('warn', message, options)
  }

  /** Write an error entry, optionally with normalized error details. */
  error(message: string, options?: LoggerWriteOptions): LogEntry | undefined {
    return this.write('error', message, options)
  }

  /** Write an entry at an explicit level. */
  write(level: LogLevel, message: string, options: LoggerWriteOptions = {}): LogEntry | undefined {
    return this.#store?.write({
      timestamp: options.timestamp,
      level,
      scope: this.scope,
      message,
      metadata: mergeJsonObjects(this.#metadata, options.metadata),
      properties: mergeJsonObjects(this.#properties, options.properties),
      error: options.error,
    })
  }
}

/** Open the high-level Scoped Logs API around a durable local store. */
export function openScopedLogs(options: OpenScopedLogsOptions = {}): ScopedLogs {
  const enabled = process.env.NODE_ENV !== 'production' || options.production === true
  if (!enabled) {
    return {
      enabled,
      store: undefined,
      logger(options) {
        return new ScopedLogger(
          undefined,
          typeof options === 'string' ? { scope: options } : options,
        )
      },
      query() {
        return { entries: [] }
      },
      tail() {
        return emptyLogTail()
      },
      expand() {
        return undefined
      },
      listScopes() {
        return []
      },
      close() {},
    }
  }

  const path = options.path ?? defaultStorePath()
  if (options.path === undefined) {
    ensureDefaultStoreGitExcluded()
  }

  const store = openLogStore({
    path,
    retention: options.retention,
    redaction: options.redaction,
    collapseAboveBytes: options.collapseAboveBytes,
  })

  return {
    enabled,
    store,
    logger(options) {
      return new ScopedLogger(store, typeof options === 'string' ? { scope: options } : options)
    },
    query(query) {
      return store.query(query)
    },
    tail(query, options) {
      return store.tail(query, options)
    },
    expand(id) {
      return store.expand(id)
    },
    listScopes() {
      return store.listScopes()
    },
    close() {
      store.close()
    },
  }
}

async function* emptyLogTail(): AsyncIterable<LogEntry> {}

/** Resolve the inferred local store path. */
export function defaultStorePath(): string {
  return resolve('.leylines/logs.sqlite')
}

function ensureDefaultStoreGitExcluded(): void {
  try {
    const gitDir = findGitDir(process.cwd())
    if (!gitDir) {
      return
    }

    const excludePath = join(resolveGitCommonDir(gitDir), 'info', 'exclude')
    const contents = readOptionalFile(excludePath)
    if (contents?.split(/\r?\n/).includes('.leylines/')) {
      return
    }

    mkdirSync(dirname(excludePath), { recursive: true })
    appendFileSync(excludePath, `${contents && !contents.endsWith('\n') ? '\n' : ''}.leylines/\n`)
  } catch {
    // Logging should keep working in non-standard or read-only Git environments.
  }
}

function findGitDir(startDir: string): string | undefined {
  let dir = resolve(startDir)
  while (true) {
    const dotGit = join(dir, '.git')
    try {
      const stats = statSync(dotGit)
      if (stats.isDirectory()) {
        return dotGit
      }
      if (stats.isFile()) {
        const match = /^gitdir:\s*(.+)$/i.exec(readFileSync(dotGit, 'utf8').trim())
        return match ? resolve(dir, match[1]) : undefined
      }
    } catch {
      // Keep walking until a Git directory is found or the filesystem root is reached.
    }

    const parent = dirname(dir)
    if (parent === dir) {
      return undefined
    }
    dir = parent
  }
}

function resolveGitCommonDir(gitDir: string): string {
  const commonDir = readOptionalFile(join(gitDir, 'commondir'))?.trim()
  return commonDir ? resolve(gitDir, commonDir) : gitDir
}

function readOptionalFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

function joinScope(parent: string, child: string): string {
  if (child.startsWith(`${parent}.`) || child === parent) {
    return child
  }
  return `${parent}.${child}`
}

function mergeJsonObjects(base: JsonObject, override: JsonObject | undefined): JsonObject {
  if (!override) {
    return base
  }

  const result: JsonObject = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const current = result[key]
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = mergeJsonObjects(toJsonObject(current), toJsonObject(value))
    } else {
      result[key] = toJsonValue(value)
    }
  }
  return result
}
