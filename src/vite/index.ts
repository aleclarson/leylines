import { openScopedLogs, type OpenScopedLogsOptions, type ScopedLogs } from '../node/index.js'
import type { JsonObject, LogEntryInput, LogLevel } from '../core/types.js'
import {
  registerPostHogMiddleware,
  resolvePostHogOptions,
  type PostHogViteOptions,
} from './posthog.js'

export type { PostHogViteOptions } from './posthog.js'

/** Options for the Leylines Vite development plugin. */
export interface ScopedLogsVitePluginOptions extends OpenScopedLogsOptions {
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

/** Minimal Vite plugin shape returned by `scopedLogsVitePlugin`. */
export interface VitePluginLike {
  /** Vite plugin name. */
  name: string
  /** Vite apply mode. */
  apply?: 'serve' | 'build'
  /** Receive resolved Vite mode and command. */
  configResolved(config: { mode?: string; command?: string }): void
  /** Register local ingestion middleware on the Vite dev server. */
  configureServer(server: ViteServerLike): void
  /** Inject browser logger setup into HTML. */
  transformIndexHtml(html: string): string
  /** Close any store resources opened by the plugin. */
  closeBundle(): void
}

/** Create a Vite plugin that captures browser logs into a local Leylines store. */
export function scopedLogsVitePlugin(options: ScopedLogsVitePluginOptions = {}): VitePluginLike {
  const endpoint = options.endpoint ?? '/__scoped_logs'
  const scope = options.scope ?? 'browser'
  const posthog = resolvePostHogOptions(options.posthog)
  let mode = 'development'
  let command = 'serve'
  let logs: ScopedLogs | undefined

  return {
    name: 'leylines:scoped-logs',
    apply: options.production ? undefined : 'serve',
    configResolved(config) {
      mode = config.mode ?? mode
      command = config.command ?? command
    },
    configureServer(server) {
      logs = openScopedLogs(options)
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
      logs?.close()
    },
  }
}

function scriptTag(endpoint: string, scope: string, options: ScopedLogsVitePluginOptions): string {
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
