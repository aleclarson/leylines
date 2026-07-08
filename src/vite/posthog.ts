import { gunzipSync } from 'node:zlib'
import { toJsonObject, toJsonValue } from '../core/json.js'
import type { JsonObject, JsonValue, LogEntryInput } from '../core/types.js'

/** Options for redirecting PostHog browser events into the local Leylines store. */
export interface PostHogViteOptions {
  /** Local PostHog-compatible ingestion endpoint. Defaults to `/__leylines/posthog`. */
  endpoint?: string
  /** Scope assigned to redirected PostHog entries. Defaults to `posthog`. */
  scope?: string
}

/** Resolved PostHog redirect settings used internally by the Vite plugin. */
export interface ResolvedPostHogOptions {
  /** Local PostHog-compatible ingestion endpoint. */
  endpoint: string
  /** Scope assigned to redirected PostHog entries. */
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
        for (const entry of posthogEntries(parsePostHogBody(body, req.url), {
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

function parsePostHogBody(body: Buffer, requestUrl?: string): unknown {
  const text = posthogBodyText(body, requestUrl)
  try {
    return JSON.parse(text)
  } catch (jsonError) {
    const params = new URLSearchParams(text)
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

function posthogBodyText(body: Buffer, requestUrl?: string): string {
  const compression = requestUrl
    ? new URL(requestUrl, 'http://localhost').searchParams.get('compression')
    : null
  if (compression === 'gzip-js' || isGzipBody(body)) {
    return gunzipSync(body).toString('utf8')
  }
  return body.toString('utf8')
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

function readBody(req: RequestLike): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    req.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

function isGzipBody(body: Buffer): boolean {
  return body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b
}
