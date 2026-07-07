import { openScopedLogs, type OpenScopedLogsOptions, type ScopedLogs } from '../node/index.js'
import { toJsonValue } from '../core/json.js'
import type { JsonObject, LogEntryInput, LogLevel } from '../core/types.js'
import {
  registerPostHogMiddleware,
  resolvePostHogOptions,
  type PostHogViteOptions,
} from './posthog.js'

export type { PostHogViteOptions } from './posthog.js'

export type ViteLoggerCaptureLevel = Extract<LogLevel, 'info' | 'warn' | 'error'>

/** Options for capturing Vite's own logger output into Leylines. */
export interface ViteLoggerCaptureOptions {
  /** Scope assigned to captured Vite logger entries. Defaults to `dev.vite`. */
  scope?: string
  /** Vite logger levels to capture. Defaults to `warn` and `error`. */
  levels?: ViteLoggerCaptureLevel[]
}

/** Options for the Leylines Vite development plugin. */
export interface LeylinesVitePluginOptions extends OpenScopedLogsOptions {
  /** Browser log ingestion endpoint injected into the page. Defaults to `/__scoped_logs`. */
  endpoint?: string
  /** Root browser logger scope. Defaults to `browser`. */
  scope?: string
  /** Capture console methods from the browser logger injection. */
  captureConsole?: boolean | LogLevel[]
  /** Capture uncaught browser errors. Defaults to `true`. */
  captureErrors?: boolean
  /** Capture unhandled promise rejections. Defaults to `true`. */
  captureRejections?: boolean
  /** Enable the plugin during production builds. Development serve mode is the default. */
  production?: boolean
  /** Metadata merged into entries written by Vite ingestion middleware. */
  metadata?: JsonObject
  /** Redirect PostHog browser product analytics into the local Leylines store. */
  posthog?: boolean | PostHogViteOptions
  /** Capture Vite's own logger output into the local Leylines store. */
  viteLogger?: boolean | ViteLoggerCaptureOptions
  /** Shorthand for `viteLogger.levels` with the default `dev.vite` scope. */
  captureViteLogger?: boolean | ViteLoggerCaptureLevel[]
}

interface ViteServerLike {
  middlewares: {
    use(
      path: string,
      handler: (req: RequestLike, res: ResponseLike, next: (error?: unknown) => void) => void,
    ): void
  }
}

interface RequestLike {
  method?: string
  on(event: 'data', listener: (chunk: Buffer | string) => void): void
  on(event: 'end', listener: () => void): void
  on(event: 'error', listener: (error: Error) => void): void
}

interface ResponseLike {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}

interface ViteResolvedConfigLike {
  mode?: string
  command?: string
  logger?: ViteLoggerLike
}

interface ViteLoggerLike {
  info?: ViteLoggerMethod
  warn?: ViteLoggerMethod
  warnOnce?: ViteLoggerMethod
  error?: ViteLoggerMethod
}

type ViteLoggerMethod = (message: string, options?: ViteLogOptionsLike, ...rest: unknown[]) => void

interface ViteLogOptionsLike {
  error?: unknown
  [key: string]: unknown
}

type ViteLoggerMethodName = 'info' | 'warn' | 'warnOnce' | 'error'

interface ResolvedViteLoggerCaptureOptions {
  scope: string
  levels: ViteLoggerCaptureLevel[]
}

/** Minimal Vite plugin shape returned by `leylines`. */
export interface VitePluginLike {
  /** Vite plugin name. */
  name: string
  /** Vite apply mode. */
  apply?: 'serve' | 'build'
  /** Receive resolved Vite mode and command. */
  configResolved(config: ViteResolvedConfigLike): void
  /** Register local ingestion middleware on the Vite dev server. */
  configureServer(server: ViteServerLike): void
  /** Inject browser logger setup into HTML. */
  transformIndexHtml(html: string): string
  /** Close any store resources opened by the plugin. */
  closeBundle(): void
}

/** Create a Vite plugin that captures browser logs into a local Leylines store. */
export function leylines(options: LeylinesVitePluginOptions = {}): VitePluginLike {
  const endpoint = options.endpoint ?? '/__scoped_logs'
  const scope = options.scope ?? 'browser'
  const posthog = resolvePostHogOptions(options.posthog)
  const viteLogger = resolveViteLoggerOptions(options)
  let mode = 'development'
  let command = 'serve'
  let logs: ScopedLogs | undefined
  let restoreViteLogger: (() => void) | undefined

  const ensureLogs = () => (logs ??= openScopedLogs(options))

  return {
    name: 'leylines:scoped-logs',
    apply: options.production ? undefined : 'serve',
    configResolved(config) {
      mode = config.mode ?? mode
      command = config.command ?? command
      if (viteLogger && config.logger) {
        restoreViteLogger?.()
        restoreViteLogger = installViteLoggerCapture(config.logger, {
          levels: new Set(viteLogger.levels),
          write(level, method, message, logOptions) {
            try {
              const normalizedMessage = stripAnsi(message)
              const error = objectProperty(logOptions, 'error')
              ensureLogs().store.write({
                level,
                scope: viteLogger.scope,
                message: normalizedMessage,
                metadata: viteLoggerMetadata({
                  base: options.metadata,
                  mode,
                  command,
                  method,
                  rawMessage: message,
                  normalizedMessage,
                  logOptions,
                  error,
                }),
                error,
              })
            } catch {
              // Vite logger capture must not affect normal terminal logging.
            }
          },
        })
      }
    },
    configureServer(server) {
      logs = ensureLogs()
      server.middlewares.use(endpoint, (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }

        readBody(req)
          .then((body) => {
            const input = JSON.parse(body) as LogEntryInput
            logs?.store.write({
              ...input,
              metadata: {
                ...options.metadata,
                ...input.metadata,
                browserUrl: input.metadata?.url ?? null,
                viteMode: mode,
                viteCommand: command,
              },
            })
            res.statusCode = 204
            res.end()
          })
          .catch((error) => {
            res.statusCode = 400
            res.setHeader('content-type', 'application/json')
            res.end(
              JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            )
          })
      })
      if (posthog) {
        registerPostHogMiddleware({
          server,
          posthog,
          write(entry) {
            logs?.store.write(entry)
          },
          metadata: options.metadata,
          mode,
          command,
        })
      }
    },
    transformIndexHtml(html) {
      if (!options.production && command === 'build') {
        return html
      }

      return html.replace(/<\/head>/i, `${scriptTag(endpoint, scope, options)}</head>`)
    },
    closeBundle() {
      restoreViteLogger?.()
      restoreViteLogger = undefined
      logs?.close()
      logs = undefined
    },
  }
}

function scriptTag(endpoint: string, scope: string, options: LeylinesVitePluginOptions): string {
  const payload = JSON.stringify({
    endpoint,
    scope,
    captureConsole: options.captureConsole ?? false,
    captureErrors: options.captureErrors ?? true,
    captureRejections: options.captureRejections ?? true,
    metadata: options.metadata ?? {},
  })

  return `<script type="module">import{logger}from"leylines/browser";logger.connect(${payload});globalThis.__leylines=logger;</script>`
}

function readBody(req: RequestLike): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = []
    req.on('data', (chunk) => {
      chunks.push(String(chunk))
    })
    req.on('end', () => {
      resolve(chunks.join(''))
    })
    req.on('error', reject)
  })
}

const defaultViteLoggerScope = 'dev.vite'
const defaultViteLoggerLevels: ViteLoggerCaptureLevel[] = ['warn', 'error']
const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g')

function resolveViteLoggerOptions(
  options: LeylinesVitePluginOptions,
): ResolvedViteLoggerCaptureOptions | undefined {
  if (options.viteLogger !== undefined) {
    if (options.viteLogger === false) {
      return undefined
    }
    if (options.viteLogger === true) {
      return {
        scope: defaultViteLoggerScope,
        levels: defaultViteLoggerLevels,
      }
    }

    return {
      scope: options.viteLogger.scope ?? defaultViteLoggerScope,
      levels: normalizeViteLoggerLevels(options.viteLogger.levels),
    }
  }

  if (options.captureViteLogger === undefined || options.captureViteLogger === false) {
    return undefined
  }

  return {
    scope: defaultViteLoggerScope,
    levels:
      options.captureViteLogger === true
        ? defaultViteLoggerLevels
        : normalizeViteLoggerLevels(options.captureViteLogger),
  }
}

function normalizeViteLoggerLevels(
  levels: ViteLoggerCaptureLevel[] | undefined,
): ViteLoggerCaptureLevel[] {
  return levels?.filter(isViteLoggerCaptureLevel) ?? defaultViteLoggerLevels
}

function isViteLoggerCaptureLevel(level: unknown): level is ViteLoggerCaptureLevel {
  return level === 'info' || level === 'warn' || level === 'error'
}

function installViteLoggerCapture(
  logger: ViteLoggerLike,
  options: {
    levels: Set<ViteLoggerCaptureLevel>
    write(
      level: ViteLoggerCaptureLevel,
      method: ViteLoggerMethodName,
      message: string,
      logOptions: ViteLogOptionsLike | undefined,
    ): void
  },
): () => void {
  const originals: Partial<Record<ViteLoggerMethodName, ViteLoggerMethod>> = {}
  const warnOnceMessages = new Set<string>()
  // Some logger implementations route warnOnce through warn; depth keeps that as one Leylines entry.
  let outputDepth = 0

  const wrap = (method: ViteLoggerMethodName, level: ViteLoggerCaptureLevel) => {
    const original = logger[method]
    if (!original || !options.levels.has(level)) {
      return
    }

    originals[method] = original
    logger[method] = function capturedViteLoggerMessage(
      this: ViteLoggerLike,
      message: string,
      logOptions?: ViteLogOptionsLike,
      ...rest: unknown[]
    ) {
      const shouldCapture =
        method !== 'warnOnce' || rememberWarnOnceMessage(warnOnceMessages, message)
      const parentDepth = outputDepth
      outputDepth += 1
      try {
        return original.apply(this, [message, logOptions, ...rest])
      } finally {
        outputDepth -= 1
        if (parentDepth === 0 && shouldCapture) {
          options.write(level, method, message, logOptions)
        }
      }
    }
  }

  wrap('info', 'info')
  wrap('warn', 'warn')
  wrap('warnOnce', 'warn')
  wrap('error', 'error')

  return () => {
    if (originals.info) {
      logger.info = originals.info
    }
    if (originals.warn) {
      logger.warn = originals.warn
    }
    if (originals.warnOnce) {
      logger.warnOnce = originals.warnOnce
    }
    if (originals.error) {
      logger.error = originals.error
    }
  }
}

function rememberWarnOnceMessage(messages: Set<string>, message: string): boolean {
  if (messages.has(message)) {
    return false
  }
  messages.add(message)
  return true
}

function viteLoggerMetadata(options: {
  base?: JsonObject
  mode: string
  command: string
  method: ViteLoggerMethodName
  rawMessage: string
  normalizedMessage: string
  logOptions: ViteLogOptionsLike | undefined
  error: unknown
}): JsonObject {
  const metadata: JsonObject = {
    ...options.base,
    source: 'vite.logger',
    viteMode: options.mode,
    viteCommand: options.command,
    viteLoggerMethod: options.method,
  }

  if (options.rawMessage !== options.normalizedMessage) {
    metadata.viteRawMessage = options.rawMessage
  }

  addStringMetadata(
    metadata,
    'vitePlugin',
    logProperty(options.logOptions, options.error, 'plugin'),
  )
  addStringMetadata(metadata, 'viteHook', logProperty(options.logOptions, options.error, 'hook'))
  addStringMetadata(metadata, 'viteModuleId', logProperty(options.logOptions, options.error, 'id'))
  addStringMetadata(metadata, 'viteCode', logProperty(options.logOptions, options.error, 'code'))
  addStringMetadata(metadata, 'viteFrame', logProperty(options.logOptions, options.error, 'frame'))

  const location = logProperty(options.logOptions, options.error, 'loc')
  if (location !== undefined) {
    metadata.viteLocation = toJsonValue(location)
  }

  return metadata
}

function addStringMetadata(metadata: JsonObject, key: string, value: unknown): void {
  if (typeof value === 'string') {
    metadata[key] = value
  }
}

function logProperty(logOptions: unknown, error: unknown, key: string): unknown {
  return objectProperty(error, key) ?? objectProperty(logOptions, key)
}

function objectProperty(value: unknown, key: string): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined
  }
  return (value as Record<string, unknown>)[key]
}

function stripAnsi(value: string): string {
  return value.replace(ansiEscapePattern, '')
}
