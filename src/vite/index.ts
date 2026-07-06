import { openScopedLogs, type OpenScopedLogsOptions, type ScopedLogs } from '../node/index.js'
import { toJsonObject, toJsonValue } from '../core/json.js'
import type { JsonObject, JsonValue, LogEntryInput, LogLevel } from '../core/types.js'

export interface ScopedLogsVitePluginOptions extends OpenScopedLogsOptions {
  endpoint?: string
  scope?: string
  captureConsole?: boolean | LogLevel[]
  captureErrors?: boolean
  captureRejections?: boolean
  production?: boolean
  metadata?: JsonObject
  posthog?: boolean | PostHogViteOptions
}

export interface PostHogViteOptions {
  endpoint?: string
  scope?: string
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
  url?: string
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
  configResolved(config: { mode?: string; command?: string }): void
  configureServer(server: ViteServerLike): void
  transformIndexHtml(html: string): string
  closeBundle(): void
}

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
        server.middlewares.use(posthog.endpoint, (req, res, next) => {
          if (req.method !== 'POST') {
            next()
            return
          }

          readBody(req)
            .then((body) => {
              for (const entry of posthogEntries(parsePostHogBody(body), {
                scope: posthog.scope,
                endpoint: posthog.endpoint,
                requestUrl: req.url,
                metadata: options.metadata,
                mode,
                command,
              })) {
                logs?.store.write(entry)
              }
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

interface ResolvedPostHogOptions {
  endpoint: string
  scope: string
}

interface PostHogEntryContext extends ResolvedPostHogOptions {
  requestUrl?: string
  metadata?: JsonObject
  mode: string
  command: string
}

function resolvePostHogOptions(options: ScopedLogsVitePluginOptions['posthog']): ResolvedPostHogOptions | undefined {
  if (!options) {
    return undefined
  }
  if (options === true) {
    return {
      endpoint: '/__leylines/posthog',
      scope: 'posthog',
    }
  }
  return {
    endpoint: options.endpoint ?? '/__leylines/posthog',
    scope: options.scope ?? 'posthog',
  }
}

function parsePostHogBody(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch (jsonError) {
    const params = new URLSearchParams(body)
    const encodedPayload = params.get('data') ?? params.get('batch')
    if (encodedPayload) {
      return JSON.parse(encodedPayload)
    }
    const event = params.get('event')
    if (event) {
      return Object.fromEntries(params)
    }
    throw jsonError
  }
}

function posthogEntries(payload: unknown, context: PostHogEntryContext): LogEntryInput[] {
  return posthogEvents(payload).map((event) => {
    const eventObject = toJsonObject(event)
    const properties = toJsonObject(eventObject.properties)
    const eventName = stringProperty(eventObject, 'event') ?? '$capture'
    const distinctId =
      jsonProperty(eventObject, 'distinct_id') ??
      jsonProperty(eventObject, 'distinctId') ??
      jsonProperty(properties, 'distinct_id') ??
      jsonProperty(properties, '$distinct_id') ??
      null

    return {
      timestamp: stringProperty(eventObject, 'timestamp') ?? stringProperty(properties, 'timestamp'),
      level: 'info',
      scope: context.scope,
      message: eventName,
      metadata: {
        ...context.metadata,
        source: 'posthog',
        posthogEndpoint: context.endpoint,
        posthogRequestUrl: context.requestUrl ?? null,
        browserUrl: jsonProperty(properties, '$current_url') ?? null,
        viteMode: context.mode,
        viteCommand: context.command,
      },
      properties: {
        event: eventName,
        distinctId,
        properties,
        payload: eventObject,
      },
    }
  })
}

function posthogEvents(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload
  }

  const object = toJsonObject(payload)
  if (Array.isArray(object.batch)) {
    return object.batch
  }
  if (Array.isArray(object.events)) {
    return object.events
  }
  return [payload]
}

function stringProperty(object: JsonObject, key: string): string | undefined {
  const value = object[key]
  return typeof value === 'string' ? value : undefined
}

function jsonProperty(object: JsonObject, key: string): JsonValue | undefined {
  const value = object[key]
  return value === undefined ? undefined : toJsonValue(value)
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
