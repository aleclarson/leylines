import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBrowserLogger } from '../src/browser.js'
import { openScopedLogs } from '../src/index.js'
import { scopedLogsVitePlugin } from '../src/vite.js'

describe('scopedLogsVitePlugin', () => {
  let dir: string
  let storePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'leylines-vite-'))
    storePath = join(dir, 'logs.sqlite')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('registers a local ingestion endpoint that writes redacted browser entries', async () => {
    const plugin = scopedLogsVitePlugin({ path: storePath, endpoint: '/logs', metadata: { viteMode: 'override' } })
    const server = fakeServer()
    plugin.configResolved({ mode: 'test', command: 'serve' })
    plugin.configureServer(server)

    await server.post('/logs', {
      level: 'info',
      scope: 'browser.router',
      message: 'route loaded',
      metadata: { url: 'http://localhost/page' },
      properties: { token: 'secret' },
    })
    plugin.closeBundle()

    const logs = openScopedLogs({ path: storePath })
    expect(logs.query({ includeDebug: true }).entries[0]).toMatchObject({
      level: 'info',
      scope: 'browser.router',
      message: 'route loaded',
      metadata: {
        browserUrl: 'http://localhost/page',
        viteMode: 'test',
        viteCommand: 'serve',
        url: 'http://localhost/page',
      },
      properties: { token: '[REDACTED]' },
    })
    logs.close()
  })

  it('injects browser logger setup for serve mode and stays quiet for build mode by default', () => {
    const serve = scopedLogsVitePlugin({ endpoint: '/logs', scope: 'app.browser', captureConsole: ['error'] })
    serve.configResolved({ mode: 'development', command: 'serve' })

    expect(serve.transformIndexHtml('<html><head></head><body></body></html>')).toContain('installBrowserLogger')
    expect(serve.transformIndexHtml('<html><head></head><body></body></html>')).toContain('"scope":"app.browser"')

    const build = scopedLogsVitePlugin()
    build.configResolved({ mode: 'production', command: 'build' })
    expect(build.transformIndexHtml('<html><head></head><body></body></html>')).toBe('<html><head></head><body></body></html>')
  })
})

describe('createBrowserLogger', () => {
  it('sends entries with browser metadata to the configured endpoint', () => {
    const calls: Array<{ url: string, body: unknown }> = []
    const logger = createBrowserLogger({
      endpoint: '/logs',
      scope: 'browser',
      metadata: { sessionId: 's1' },
      fetch: ((url: string, init: { body?: string }) => {
        calls.push({ url, body: JSON.parse(init.body ?? '{}') })
        return Promise.resolve({ ok: true })
      }) as typeof fetch,
    })

    logger.child({ scope: 'router', properties: { route: '/home' } }).info('route loaded')

    expect(calls).toEqual([
      {
        url: '/logs',
        body: expect.objectContaining({
          level: 'info',
          scope: 'browser.router',
          message: 'route loaded',
          metadata: expect.objectContaining({ sessionId: 's1' }),
          properties: { route: '/home' },
        }),
      },
    ])
  })
})

function fakeServer() {
  const handlers = new Map<string, (req: FakeRequest, res: FakeResponse, next: () => void) => void>()

  return {
    middlewares: {
      use(path: string, handler: (req: FakeRequest, res: FakeResponse, next: () => void) => void) {
        handlers.set(path, handler)
      },
    },
    post(path: string, body: unknown) {
      const handler = handlers.get(path)
      if (!handler) {
        throw new Error(`No handler for ${path}`)
      }

      const req = new FakeRequest('POST')
      const res = new FakeResponse()
      handler(req, res, () => {})
      req.emit('data', JSON.stringify(body))
      req.emit('end')
      return res.done
    },
  }
}

class FakeRequest extends EventEmitter {
  readonly method: string

  constructor(method: string) {
    super()
    this.method = method
  }
}

class FakeResponse {
  statusCode = 200
  done: Promise<void>
  #resolve!: () => void

  constructor() {
    this.done = new Promise(resolve => {
      this.#resolve = resolve
    })
  }

  setHeader() {}

  end() {
    this.#resolve()
  }
}
