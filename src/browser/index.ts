import { toJsonValue } from '../core/json.js'
import type { JsonObject, JsonValue, LogEntryInput, LogLevel } from '../core/types.js'

/** Transport and inherited context for the browser logger. */
export interface BrowserLoggerOptions {
  /** Local ingestion endpoint that receives JSON log entries. */
  endpoint: string
  /** Root scope for entries. Defaults to `browser`. */
  scope?: string
  /** Metadata inherited by every browser entry. */
  metadata?: JsonObject
  /** Structured properties inherited by every browser entry. */
  properties?: JsonObject
  /** Fetch implementation to use. Defaults to global `fetch`. */
  fetch?: typeof fetch
}

/** Browser logger API used by application code. */
export interface BrowserLogger {
  /** Current dotted domain scope for entries from this logger. */
  readonly scope: string
  /** Create a child logger with merged inherited context and a nested scope. */
  child(options: { scope?: string; properties?: JsonObject; metadata?: JsonObject }): BrowserLogger
  /** Write a debug entry. */
  debug(message: string, properties?: JsonObject): void
  /** Write an info entry. */
  info(message: string, properties?: JsonObject): void
  /** Write a warning entry. */
  warn(message: string, properties?: JsonObject): void
  /** Write an error entry, optionally with normalized error details. */
  error(message: string, properties?: JsonObject, error?: unknown): void
  /** Write an entry at an explicit level. */
  write(level: LogLevel, message: string, properties?: JsonObject, error?: unknown): void
}

/** Singleton browser logger that can be connected to a runtime ingestion endpoint. */
export interface BrowserLoggerSingleton extends BrowserLogger {
  /** Connect or reconfigure the singleton logger and optional browser capture hooks. */
  connect(options: BrowserLoggerConnectOptions): BrowserLoggerSingleton
}

/** Options for connecting the singleton browser logger. */
export interface BrowserLoggerConnectOptions extends BrowserLoggerOptions {
  /** Capture console methods. `true` captures all levels; an array captures selected levels. */
  captureConsole?: boolean | LogLevel[]
  /** Capture uncaught browser errors. Defaults to `true`. */
  captureErrors?: boolean
  /** Capture unhandled promise rejections. Defaults to `true`. */
  captureRejections?: boolean
}

function createBrowserLogger(options: BrowserLoggerOptions): BrowserLogger {
  const transport = options.fetch ?? fetch
  const browserGlobal = globalThis as typeof globalThis & {
    location?: { href?: string }
    navigator?: { userAgent?: string }
  }
  const metadata: JsonObject = {
    ...options.metadata,
  }
  if (browserGlobal.location?.href) {
    metadata.url = browserGlobal.location.href
  }
  if (browserGlobal.navigator?.userAgent) {
    metadata.userAgent = browserGlobal.navigator.userAgent
  }

  return new BrowserScopedLogger({
    endpoint: options.endpoint,
    fetch: transport,
    scope: options.scope ?? 'browser',
    metadata,
    properties: options.properties ?? {},
  })
}

type BrowserLoggerChildOptions = { scope?: string; properties?: JsonObject; metadata?: JsonObject }

class BrowserLoggerRoot implements BrowserLoggerSingleton {
  #active: BrowserLogger | undefined
  #scope = 'browser'
  #consoleOriginals = new Map<LogLevel, (...args: unknown[]) => void>()
  #errorListener: ((event: unknown) => void) | undefined
  #rejectionListener: ((event: unknown) => void) | undefined

  get scope(): string {
    return this.#scope
  }

  connect(options: BrowserLoggerConnectOptions): BrowserLoggerSingleton {
    this.#active = createBrowserLogger(options)
    this.#scope = options.scope ?? 'browser'
    this.#configureConsoleCapture(options.captureConsole)
    this.#configureErrorCapture(options.captureErrors ?? true)
    this.#configureRejectionCapture(options.captureRejections ?? true)
    return this
  }

  child(options: BrowserLoggerChildOptions): BrowserLogger {
    return new BrowserLoggerChild(this, options)
  }

  debug(message: string, properties?: JsonObject): void {
    this.write('debug', message, properties)
  }

  info(message: string, properties?: JsonObject): void {
    this.write('info', message, properties)
  }

  warn(message: string, properties?: JsonObject): void {
    this.write('warn', message, properties)
  }

  error(message: string, properties?: JsonObject, error?: unknown): void {
    this.write('error', message, properties, error)
  }

  write(level: LogLevel, message: string, properties?: JsonObject, error?: unknown): void {
    this.writeFrom(undefined, level, message, properties, error)
  }

  writeFrom(
    childOptions: BrowserLoggerChildOptions | undefined,
    level: LogLevel,
    message: string,
    properties?: JsonObject,
    error?: unknown,
  ): void {
    let target = this.#active
    if (!target) {
      return
    }
    if (childOptions) {
      target = target.child(childOptions)
    }
    target.write(level, message, properties, error)
  }

  #configureConsoleCapture(captureConsole: boolean | LogLevel[] | undefined): void {
    const levels = new Set<LogLevel>(
      captureConsole
        ? Array.isArray(captureConsole)
          ? captureConsole
          : ['debug', 'info', 'warn', 'error']
        : [],
    )
    for (const level of LOG_LEVELS) {
      if (levels.has(level)) {
        this.#captureConsoleLevel(level)
        continue
      }
      this.#restoreConsoleLevel(level)
    }
  }

  #captureConsoleLevel(level: LogLevel): void {
    if (this.#consoleOriginals.has(level)) {
      return
    }

    const original = consoleMethod(level)
    this.#consoleOriginals.set(level, original)
    console[level] = (...args: unknown[]) => {
      original.apply(console, args)
      this.write(level, args.map(formatConsoleArg).join(' '), { console: true })
    }
  }

  #restoreConsoleLevel(level: LogLevel): void {
    const original = this.#consoleOriginals.get(level)
    if (!original) {
      return
    }
    console[level] = original
    this.#consoleOriginals.delete(level)
  }

  #configureErrorCapture(enabled: boolean): void {
    const eventTarget = browserEventTarget()
    if (enabled) {
      if (this.#errorListener) {
        return
      }
      this.#errorListener = (event) => {
        this.error(
          'Uncaught error',
          {
            filename: readJsonProperty(event, 'filename'),
            lineno: readJsonProperty(event, 'lineno'),
            colno: readJsonProperty(event, 'colno'),
          },
          readProperty(event, 'error') ?? readProperty(event, 'message'),
        )
      }
      eventTarget.addEventListener?.('error', this.#errorListener)
      return
    }

    if (this.#errorListener) {
      eventTarget.removeEventListener?.('error', this.#errorListener)
      this.#errorListener = undefined
    }
  }

  #configureRejectionCapture(enabled: boolean): void {
    const eventTarget = browserEventTarget()
    if (enabled) {
      if (this.#rejectionListener) {
        return
      }
      this.#rejectionListener = (event) => {
        this.error('Unhandled promise rejection', {}, readProperty(event, 'reason'))
      }
      eventTarget.addEventListener?.('unhandledrejection', this.#rejectionListener)
      return
    }

    if (this.#rejectionListener) {
      eventTarget.removeEventListener?.('unhandledrejection', this.#rejectionListener)
      this.#rejectionListener = undefined
    }
  }
}

class BrowserLoggerChild implements BrowserLogger {
  #root: BrowserLoggerRoot
  #options: BrowserLoggerChildOptions

  constructor(root: BrowserLoggerRoot, options: BrowserLoggerChildOptions) {
    this.#root = root
    this.#options = options
  }

  get scope(): string {
    return this.#options.scope ? joinScope(this.#root.scope, this.#options.scope) : this.#root.scope
  }

  child(options: BrowserLoggerChildOptions): BrowserLogger {
    return new BrowserLoggerChild(this.#root, {
      scope: options.scope
        ? this.#options.scope
          ? joinScope(this.#options.scope, options.scope)
          : options.scope
        : this.#options.scope,
      metadata: { ...this.#options.metadata, ...options.metadata },
      properties: { ...this.#options.properties, ...options.properties },
    })
  }

  debug(message: string, properties?: JsonObject): void {
    this.write('debug', message, properties)
  }

  info(message: string, properties?: JsonObject): void {
    this.write('info', message, properties)
  }

  warn(message: string, properties?: JsonObject): void {
    this.write('warn', message, properties)
  }

  error(message: string, properties?: JsonObject, error?: unknown): void {
    this.write('error', message, properties, error)
  }

  write(level: LogLevel, message: string, properties?: JsonObject, error?: unknown): void {
    this.#root.writeFrom(this.#options, level, message, properties, error)
  }
}

/** Side-effect-free singleton browser logger. Call `logger.connect` before entries are sent. */
export const logger: BrowserLoggerSingleton = new BrowserLoggerRoot()

interface BrowserScopedLoggerOptions {
  endpoint: string
  fetch: typeof fetch
  scope: string
  metadata: JsonObject
  properties: JsonObject
}

class BrowserScopedLogger implements BrowserLogger {
  readonly scope: string

  #endpoint: string
  #fetch: typeof fetch
  #metadata: JsonObject
  #properties: JsonObject

  constructor(options: BrowserScopedLoggerOptions) {
    this.#endpoint = options.endpoint
    this.#fetch = options.fetch
    this.scope = options.scope
    this.#metadata = options.metadata
    this.#properties = options.properties
  }

  child(options: {
    scope?: string
    properties?: JsonObject
    metadata?: JsonObject
  }): BrowserLogger {
    return new BrowserScopedLogger({
      endpoint: this.#endpoint,
      fetch: this.#fetch,
      scope: options.scope ? joinScope(this.scope, options.scope) : this.scope,
      metadata: { ...this.#metadata, ...options.metadata },
      properties: { ...this.#properties, ...options.properties },
    })
  }

  debug(message: string, properties?: JsonObject): void {
    this.write('debug', message, properties)
  }

  info(message: string, properties?: JsonObject): void {
    this.write('info', message, properties)
  }

  warn(message: string, properties?: JsonObject): void {
    this.write('warn', message, properties)
  }

  error(message: string, properties?: JsonObject, error?: unknown): void {
    this.write('error', message, properties, error)
  }

  write(level: LogLevel, message: string, properties?: JsonObject, error?: unknown): void {
    const entry: LogEntryInput = {
      level,
      scope: this.scope,
      message,
      metadata: this.#metadata,
      properties: { ...this.#properties, ...properties },
      error,
    }

    void this.#fetch(this.#endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
      keepalive: true,
    }).catch(() => {})
  }
}

function joinScope(parent: string, child: string): string {
  if (child === parent || child.startsWith(`${parent}.`)) {
    return child
  }
  return `${parent}.${child}`
}

function formatConsoleArg(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function consoleMethod(level: LogLevel): (...args: unknown[]) => void {
  switch (level) {
    case 'debug':
      return console.debug
    case 'info':
      return console.info
    case 'warn':
      return console.warn
    case 'error':
      return console.error
  }
}

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']

function browserEventTarget(): typeof globalThis & {
  addEventListener?: (type: string, listener: (event: unknown) => void) => void
  removeEventListener?: (type: string, listener: (event: unknown) => void) => void
} {
  return globalThis
}

function readProperty(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
}

function readJsonProperty(value: unknown, key: string): JsonValue {
  const property = readProperty(value, key)
  return property === undefined ? null : toJsonValue(property)
}
