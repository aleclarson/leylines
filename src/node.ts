import { resolve } from 'node:path'
import { isPlainObject } from 'radashi'
import { openLogStore, type LogStore } from './store.js'
import { toJsonObject, toJsonValue } from './json.js'
import type { JsonObject, LogEntry, LogEntryInput, LogLevel, LogQuery, RedactionOptions, RetentionOptions } from './types.js'

export interface OpenScopedLogsOptions {
  path?: string
  retention?: RetentionOptions
  redaction?: RedactionOptions
  collapseAboveBytes?: number
}

export interface LoggerOptions {
  scope: string
  properties?: JsonObject
  metadata?: JsonObject
}

export interface LoggerWriteOptions {
  properties?: JsonObject
  metadata?: JsonObject
  error?: unknown
  timestamp?: Date | string
}

export interface ScopedLogs {
  readonly store: LogStore
  logger(options: LoggerOptions | string): ScopedLogger
  query(query?: LogQuery): ReturnType<LogStore['query']>
  tail(query?: LogQuery, options?: { signal?: AbortSignal }): AsyncIterable<LogEntry>
  expand(id: string): ReturnType<LogStore['expand']>
  listScopes(): string[]
  close(): void
}

export class ScopedLogger {
  readonly scope: string

  #store: LogStore
  #properties: JsonObject
  #metadata: JsonObject

  constructor(store: LogStore, options: LoggerOptions) {
    this.#store = store
    this.scope = options.scope
    this.#properties = options.properties ?? {}
    this.#metadata = options.metadata ?? {}
  }

  child(options: Partial<LoggerOptions> & { scope?: string } = {}): ScopedLogger {
    return new ScopedLogger(this.#store, {
      scope: options.scope ? joinScope(this.scope, options.scope) : this.scope,
      properties: mergeJsonObjects(this.#properties, options.properties),
      metadata: mergeJsonObjects(this.#metadata, options.metadata),
    })
  }

  debug(message: string, options?: LoggerWriteOptions): LogEntry {
    return this.write('debug', message, options)
  }

  info(message: string, options?: LoggerWriteOptions): LogEntry {
    return this.write('info', message, options)
  }

  warn(message: string, options?: LoggerWriteOptions): LogEntry {
    return this.write('warn', message, options)
  }

  error(message: string, options?: LoggerWriteOptions): LogEntry {
    return this.write('error', message, options)
  }

  write(level: LogLevel, message: string, options: LoggerWriteOptions = {}): LogEntry {
    return this.#store.write({
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

export function openScopedLogs(options: OpenScopedLogsOptions = {}): ScopedLogs {
  const store = openLogStore({
    path: options.path ?? defaultStorePath(),
    retention: options.retention,
    redaction: options.redaction,
    collapseAboveBytes: options.collapseAboveBytes,
  })

  return {
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

export function defaultStorePath(): string {
  return resolve(process.env.SCOPED_LOGS_STORE ?? process.env.LEYLINES_STORE ?? '.leylines/logs.sqlite')
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
    }
    else {
      result[key] = toJsonValue(value)
    }
  }
  return result
}
