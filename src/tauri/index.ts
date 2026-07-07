import { attachLogger, LogLevel as TauriPluginLogLevel } from '@tauri-apps/plugin-log'
import { logger, type BrowserLogger } from '../browser/index.js'
import type { JsonObject, LogLevel } from '../core/types.js'

/** Function returned by Tauri's logger attachment to stop forwarding records. */
export type DetachTauriLogger = () => void

/** Options for forwarding Tauri plugin-log records into Leylines. */
export interface TauriLoggerOptions {
  /** Browser logger receiving forwarded records. Defaults to the Leylines singleton. */
  logger?: BrowserLogger
  /** Child scope under the connected browser logger. Defaults to `tauri`. */
  scope?: string
  /** Metadata inherited by every forwarded Tauri record. */
  metadata?: JsonObject
  /** Structured properties inherited by every forwarded Tauri record. */
  properties?: JsonObject
}

/** Attach Tauri plugin-log forwarding to the Leylines browser logger connected by the Vite plugin. */
export function attachTauriLogger(options: TauriLoggerOptions = {}): DetachTauriLogger {
  const controller = new AbortController()
  const target = (options.logger ?? logger).child({
    scope: options.scope ?? 'tauri',
    metadata: {
      ...options.metadata,
      source: 'tauri.log',
    },
    properties: options.properties,
  })

  void attachLogger((record) => {
    if (!controller.signal.aborted) {
      try {
        target.write(toLeylinesLevel(record.level), record.message)
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
