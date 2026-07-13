import { attachLogger, LogLevel as TauriPluginLogLevel } from '@tauri-apps/plugin-log'
import { logger, type BrowserLogger } from '../browser/index.js'
import { isTestEnvironment } from '../core/environment.js'
import type { JsonObject, LogLevel } from '../core/types.js'

/** Function returned by Tauri's logger attachment to stop forwarding records. */
export type DetachTauriLogger = () => void

/** Options for forwarding Tauri plugin-log records into Leylines. */
export interface TauriLoggerOptions {
  /** Browser logger receiving forwarded records. Defaults to the Leylines singleton. */
  logger?: BrowserLogger
  /** Enable forwarding in recognized test environments. Disabled by default. */
  test?: boolean
  /** Scope assigned to forwarded Tauri records. Defaults to `tauri`. */
  scope?: string
  /** Structured context inherited by every forwarded Tauri record. */
  metadata?: JsonObject
  /** Structured properties inherited by every forwarded Tauri record. */
  properties?: JsonObject
}

/** Attach Tauri plugin-log forwarding to the Leylines browser logger connected by the Vite plugin. */
export function attachTauriLogger(options: TauriLoggerOptions = {}): DetachTauriLogger {
  if (isTestEnvironment() && options.test !== true) {
    return () => {}
  }

  const controller = new AbortController()
  const target = options.logger ?? logger
  const scope = options.scope ?? 'tauri'
  const properties = {
    ...options.properties,
    ...options.metadata,
    source: 'tauri.log',
  }

  void attachLogger((record) => {
    if (!controller.signal.aborted) {
      try {
        target.write(toLeylinesLevel(record.level), scope, record.message, properties)
      } catch {
        // Forwarding must not interfere with Tauri's own log delivery.
      }
    }
  })
    .then((detach) => {
      if (controller.signal.aborted) {
        detach()
        return
      }

      controller.signal.addEventListener('abort', () => detach(), { once: true })
    })
    .catch(() => {})

  return () => {
    controller.abort()
  }
}

function toLeylinesLevel(level: TauriPluginLogLevel): LogLevel {
  switch (level) {
    case TauriPluginLogLevel.Trace:
    case TauriPluginLogLevel.Debug:
      return 'debug'
    case TauriPluginLogLevel.Info:
      return 'info'
    case TauriPluginLogLevel.Warn:
      return 'warn'
    case TauriPluginLogLevel.Error:
      return 'error'
  }
  return 'info'
}
