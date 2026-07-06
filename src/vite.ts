import { openScopedLogs, type OpenScopedLogsOptions, type ScopedLogs } from './node.js'
import type { JsonObject, LogEntryInput, LogLevel } from './types.js'

export interface ScopedLogsVitePluginOptions extends OpenScopedLogsOptions {
  endpoint?: string
  scope?: string
  captureConsole?: boolean | LogLevel[]
  captureErrors?: boolean
  captureRejections?: boolean
  production?: boolean
  metadata?: JsonObject
}

interface ViteServerLike {
  middlewares: {
    use(path: string, handler: (req: RequestLike, res: ResponseLike, next: (error?: unknown) => void) => void): void
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

export interface VitePluginLike {
  name: string
  apply?: 'serve' | 'build'
  configResolved(config: { mode?: string, command?: string }): void
  configureServer(server: ViteServerLike): void
  transformIndexHtml(html: string): string
  closeBundle(): void
}

export function scopedLogsVitePlugin(options: ScopedLogsVitePluginOptions = {}): VitePluginLike {
  const endpoint = options.endpoint ?? '/__scoped_logs'
  const scope = options.scope ?? 'browser'
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

        readBody(req).then(body => {
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
        }).catch(error => {
          res.statusCode = 400
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        })
      })
    },
    transformIndexHtml(html) {
      if (!options.production && command === 'build') {
        return html
      }

      return html.replace(
        /<\/head>/i,
        `${scriptTag(endpoint, scope, options)}</head>`,
      )
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

  return `<script type="module">import{installBrowserLogger}from"leylines/browser";globalThis.__leylines=installBrowserLogger(${payload});</script>`
}

function readBody(req: RequestLike): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = []
    req.on('data', chunk => {
      chunks.push(String(chunk))
    })
    req.on('end', () => {
      resolve(chunks.join(''))
    })
    req.on('error', reject)
  })
}
