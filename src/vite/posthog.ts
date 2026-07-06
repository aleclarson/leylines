import { toJsonObject, toJsonValue } from '../core/json.js'
import type { JsonObject, JsonValue, LogEntryInput } from '../core/types.js'

export interface PostHogViteOptions {
  endpoint?: string
  scope?: string
}

export interface ResolvedPostHogOptions {
  endpoint: string
  scope: string
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

interface PostHogEntryContext extends ResolvedPostHogOptions {
  requestUrl?: string
  metadata?: JsonObject
  mode: string
  command: string
}

export function resolvePostHogOptions(
  options: boolean | PostHogViteOptions | undefined,
): ResolvedPostHogOptions | undefined {
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

export function registerPostHogMiddleware(options: {
  server: ViteServerLike
  posthog: ResolvedPostHogOptions
  write(entry: LogEntryInput): void
  metadata?: JsonObject
  mode: string
  command: string
}): void {
  options.server.middlewares.use(options.posthog.endpoint, (req, res, next) => {
    if (req.method !== 'POST') {
      next()
      return
    }

    readBody(req)
      .then((body) => {
        for (const entry of posthogEntries(parsePostHogBody(body), {
          scope: options.posthog.scope,
          endpoint: options.posthog.endpoint,
          requestUrl: req.url,
          metadata: options.metadata,
          mode: options.mode,
          command: options.command,
        })) {
          options.write(entry)
        }
        res.statusCode = 204
        res.end()
      })
      .catch((error) => {
        res.statusCode = 400
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      })
  })
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
      timestamp:
        stringProperty(eventObject, 'timestamp') ?? stringProperty(properties, 'timestamp'),
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
