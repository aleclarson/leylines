import { toJsonValue } from '../core/json.js'
import type { JsonObject, JsonValue, LogEntryInput, LogLevel } from '../core/types.js'

export interface BrowserLoggerOptions {
  endpoint: string
  scope: string
  metadata?: JsonObject
  properties?: JsonObject
  fetch?: typeof fetch
}

export interface BrowserLogger {
  readonly scope: string
  child(options: { scope?: string, properties?: JsonObject, metadata?: JsonObject }): BrowserLogger
  debug(message: string, properties?: JsonObject): void
  info(message: string, properties?: JsonObject): void
  warn(message: string, properties?: JsonObject): void
  error(message: string, properties?: JsonObject, error?: unknown): void
  write(level: LogLevel, message: string, properties?: JsonObject, error?: unknown): void
}

export interface BrowserCaptureOptions extends BrowserLoggerOptions {
  captureConsole?: boolean | LogLevel[]
  captureErrors?: boolean
  captureRejections?: boolean
}

export function createBrowserLogger(options: BrowserLoggerOptions): BrowserLogger {
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
    scope: options.scope,
    metadata,
    properties: options.properties ?? {},
  })
}

export function installBrowserLogger(options: BrowserCaptureOptions): BrowserLogger {
  const logger = createBrowserLogger(options)

  if (options.captureConsole) {
    const capturedLevels: LogLevel[] = Array.isArray(options.captureConsole) ? options.captureConsole : ['debug', 'info', 'warn', 'error']
    for (const level of capturedLevels) {
      const original = consoleMethod(level)
      console[level] = (...args: unknown[]) => {
        original.apply(console, args)
        logger.write(level, args.map(formatConsoleArg).join(' '), { console: true })
      }
    }
  }

  const eventTarget = globalThis as typeof globalThis & {
    addEventListener?: (type: string, listener: (event: unknown) => void) => void
  }

  if (options.captureErrors ?? true) {
    eventTarget.addEventListener?.('error', event => {
      logger.error('Uncaught error', {
        filename: readJsonProperty(event, 'filename'),
        lineno: readJsonProperty(event, 'lineno'),
        colno: readJsonProperty(event, 'colno'),
      }, readProperty(event, 'error') ?? readProperty(event, 'message'))
    })
  }

  if (options.captureRejections ?? true) {
    eventTarget.addEventListener?.('unhandledrejection', event => {
      logger.error('Unhandled promise rejection', {}, readProperty(event, 'reason'))
    })
  }

  return logger
}

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

  child(options: { scope?: string, properties?: JsonObject, metadata?: JsonObject }): BrowserLogger {
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
  }
  catch {
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

function readProperty(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
}

function readJsonProperty(value: unknown, key: string): JsonValue {
  const property = readProperty(value, key)
  return property === undefined ? null : toJsonValue(property)
}
