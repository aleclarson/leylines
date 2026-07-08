import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { logger } from '../src/browser/index.js'
import { openScopedLogs } from '../src/index.js'
import { leylines } from '../src/vite/index.js'

describe('leylines', () => {
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
    const plugin = leylines({
      path: storePath,
      endpoint: '/logs',
      metadata: { viteMode: 'override' },
    })
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
    const serve = leylines({
      endpoint: '/logs',
      scope: 'app.browser',
      captureConsole: ['error'],
    })
    serve.configResolved({ mode: 'development', command: 'serve' })

    expect(serve.transformIndexHtml('<html><head></head><body></body></html>')).toContain(
      'logger.connect',
    )
    expect(serve.transformIndexHtml('<html><head></head><body></body></html>')).toContain(
      '"scope":"app.browser"',
    )

    const build = leylines()
    build.configResolved({ mode: 'production', command: 'build' })
    expect(build.transformIndexHtml('<html><head></head><body></body></html>')).toBe(
      '<html><head></head><body></body></html>',
    )
  })

  it('strips browser logger calls from production builds', () => {
    const plugin = leylines({
      production: true,
      stripProduction: true,
    })
    plugin.configResolved({ mode: 'production', command: 'build' })

    expect(plugin.transformIndexHtml('<html><head></head><body></body></html>')).toBe(
      '<html><head></head><body></body></html>',
    )
    expect(
      plugin.transform(
        [
          "import { logger } from 'leylines/browser'",
          "logger.info('checkout', 'loaded', { cartId })",
          "logger.error('checkout.payment', 'failed', {}, error)",
          'const answer = 42',
        ].join('\n'),
        '/src/App.tsx',
      ),
    ).toBe('const answer = 42')
  })

  it('keeps a no-op logger when stripped production modules still reference it', () => {
    const plugin = leylines({ stripProduction: true })
    plugin.configResolved({ mode: 'production', command: 'build' })

    const transformed = plugin.transform(
      [
        "import { type BrowserLogger, logger as appLogger } from 'leylines/browser'",
        "appLogger.warn('checkout', 'retrying')",
        'export const currentLogger = appLogger',
      ].join('\n'),
      '/src/logger.ts',
    )

    expect(transformed).toContain('const __leylinesNoopLogger = {')
    expect(transformed).toContain('const appLogger = __leylinesNoopLogger')
    expect(transformed).toContain("import { type BrowserLogger } from 'leylines/browser'")
    expect(transformed).toContain('export const currentLogger = appLogger')
    expect(transformed).not.toContain("appLogger.warn('checkout', 'retrying')")
  })

  it('does not rewrite browser logger calls during serve mode', () => {
    const plugin = leylines({ stripProduction: true })
    plugin.configResolved({ mode: 'development', command: 'serve' })

    expect(
      plugin.transform(
        "import { logger } from 'leylines/browser'\nlogger.info('checkout', 'loaded')",
        '/src/App.tsx',
      ),
    ).toBeNull()
  })

  it('redirects PostHog capture payloads into the local log store', async () => {
    const plugin = leylines({
      path: storePath,
      posthog: true,
    })
    const server = fakeServer()
    plugin.configResolved({ mode: 'development', command: 'serve' })
    plugin.configureServer(server)

    await server.post('/__leylines/posthog', {
      event: 'signup_clicked',
      distinct_id: 'user-1',
      properties: {
        $current_url: 'http://localhost/signup',
        plan: 'pro',
        token: 'secret',
      },
    })
    await server.postBody(
      '/__leylines/posthog',
      new URLSearchParams({
        event: 'invite_sent',
        distinct_id: 'user-2',
      }).toString(),
    )
    plugin.closeBundle()

    const logs = openScopedLogs({ path: storePath })
    const entries = logs.query({ scope: 'posthog', includeDebug: true }).entries
    expect(entries[0]).toMatchObject({
      level: 'info',
      scope: 'posthog',
      message: 'signup_clicked',
      metadata: {
        source: 'posthog',
        posthogEndpoint: '/__leylines/posthog',
        posthogRequestUrl: '/__leylines/posthog',
        browserUrl: 'http://localhost/signup',
        viteMode: 'development',
        viteCommand: 'serve',
      },
      properties: {
        event: 'signup_clicked',
        distinctId: 'user-1',
        properties: {
          plan: 'pro',
          token: '[REDACTED]',
        },
      },
    })
    expect(entries[1]).toMatchObject({
      scope: 'posthog',
      message: 'invite_sent',
      properties: {
        event: 'invite_sent',
        distinctId: 'user-2',
      },
    })
    logs.close()
  })

  it('redirects PostHog batch payloads with custom endpoint and scope', async () => {
    const plugin = leylines({
      path: storePath,
      posthog: {
        endpoint: '/analytics',
        scope: 'metrics.product',
      },
    })
    const server = fakeServer()
    plugin.configureServer(server)

    await server.post('/analytics', {
      batch: [
        { event: '$pageview', properties: { distinct_id: 'user-1' } },
        { event: 'project_created', properties: { projectId: 'project-1' } },
      ],
    })
    plugin.closeBundle()

    const logs = openScopedLogs({ path: storePath })
    expect(logs.query({ scope: 'metrics.product', includeDebug: true }).entries).toEqual([
      expect.objectContaining({
        scope: 'metrics.product',
        message: '$pageview',
        properties: expect.objectContaining({
          event: '$pageview',
          distinctId: 'user-1',
        }),
      }),
      expect.objectContaining({
        scope: 'metrics.product',
        message: 'project_created',
        properties: expect.objectContaining({
          event: 'project_created',
          properties: { projectId: 'project-1' },
        }),
      }),
    ])
    logs.close()
  })

  it('redirects compressed PostHog event endpoint payloads', async () => {
    const plugin = leylines({
      path: storePath,
      posthog: true,
    })
    const server = fakeServer()
    plugin.configureServer(server)

    await server.postBody(
      '/__leylines/posthog/e/?_=1783544598932&ver=1.395.0&compression=gzip-js',
      gzipSync(
        JSON.stringify({
          event: '$pageview',
          distinct_id: 'user-1',
          properties: {
            $current_url: 'http://localhost:5173/dashboard',
            token: 'secret',
          },
        }),
      ),
    )
    plugin.closeBundle()

    const logs = openScopedLogs({ path: storePath })
    const entries = logs.query({ scope: 'posthog', includeDebug: true }).entries
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      scope: 'posthog',
      message: '$pageview',
      metadata: {
        source: 'posthog',
        posthogEndpoint: '/__leylines/posthog',
        posthogRequestUrl: '/e/?_=1783544598932&ver=1.395.0&compression=gzip-js',
        browserUrl: 'http://localhost:5173/dashboard',
      },
      properties: {
        event: '$pageview',
        distinctId: 'user-1',
        properties: {
          token: '[REDACTED]',
        },
      },
    })
    logs.close()
  })

  it('captures Vite logger warnings and errors with structured metadata', () => {
    const terminalOutput: Array<{ level: string; message: string }> = []
    const viteError = Object.assign(new Error('import failed'), {
      plugin: 'vite:import-analysis',
      hook: 'transform',
      id: '/src/App.tsx',
      code: 'PLUGIN_ERROR',
      loc: { file: '/src/App.tsx', line: 12, column: 8 },
      frame: '11 | import missing',
    })
    const viteLogger = {
      info(message: string, _options?: { error?: unknown }) {
        terminalOutput.push({ level: 'info', message })
      },
      warn(message: string, _options?: { error?: unknown }) {
        terminalOutput.push({ level: 'warn', message })
      },
      warnOnce(message: string, options?: { error?: unknown }) {
        terminalOutput.push({ level: 'warnOnce', message })
        this.warn(message, options)
      },
      error(message: string, _options?: { error?: unknown }) {
        terminalOutput.push({ level: 'error', message })
      },
    }
    const plugin = leylines({
      path: storePath,
      metadata: { testRun: 'vite-logger' },
      viteLogger: {
        scope: 'dev.vite',
        levels: ['warn', 'error'],
      },
    })
    plugin.configResolved({ mode: 'development', command: 'serve', logger: viteLogger })

    viteLogger.info('dev server ready')
    viteLogger.warn('\x1b[33mimport could not be analyzed\x1b[39m', { error: viteError })
    viteLogger.warnOnce('warn once only', { error: viteError })
    viteLogger.warnOnce('warn once only', { error: viteError })
    viteLogger.error('hmr update failed', { error: viteError })
    plugin.closeBundle()

    expect(terminalOutput).toEqual([
      { level: 'info', message: 'dev server ready' },
      { level: 'warn', message: '\x1b[33mimport could not be analyzed\x1b[39m' },
      { level: 'warnOnce', message: 'warn once only' },
      { level: 'warn', message: 'warn once only' },
      { level: 'warnOnce', message: 'warn once only' },
      { level: 'warn', message: 'warn once only' },
      { level: 'error', message: 'hmr update failed' },
    ])

    const logs = openScopedLogs({ path: storePath })
    const entries = logs.query({ scope: 'dev.vite', includeDebug: true }).entries
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({
      level: 'warn',
      scope: 'dev.vite',
      message: 'import could not be analyzed',
      metadata: {
        testRun: 'vite-logger',
        source: 'vite.logger',
        viteMode: 'development',
        viteCommand: 'serve',
        viteLoggerMethod: 'warn',
        viteRawMessage: '\x1b[33mimport could not be analyzed\x1b[39m',
        vitePlugin: 'vite:import-analysis',
        viteHook: 'transform',
        viteModuleId: '/src/App.tsx',
        viteCode: 'PLUGIN_ERROR',
        viteFrame: '11 | import missing',
        viteLocation: { file: '/src/App.tsx', line: 12, column: 8 },
      },
      error: {
        name: 'Error',
        message: 'import failed',
        stack: expect.any(String),
      },
    })
    expect(
      entries.map((entry) => [entry.level, entry.message, entry.metadata.viteLoggerMethod]),
    ).toEqual([
      ['warn', 'import could not be analyzed', 'warn'],
      ['warn', 'warn once only', 'warnOnce'],
      ['error', 'hmr update failed', 'error'],
    ])
    logs.close()
  })

  it('supports shorthand Vite logger level capture', () => {
    const terminalOutput: string[] = []
    const viteLogger = {
      warn(message: string) {
        terminalOutput.push(`warn:${message}`)
      },
      error(message: string) {
        terminalOutput.push(`error:${message}`)
      },
    }
    const plugin = leylines({
      path: storePath,
      captureViteLogger: ['error'],
    })
    plugin.configResolved({ logger: viteLogger })

    viteLogger.warn('still terminal-only')
    viteLogger.error('captured error')
    plugin.closeBundle()

    expect(terminalOutput).toEqual(['warn:still terminal-only', 'error:captured error'])

    const logs = openScopedLogs({ path: storePath })
    expect(logs.query({ scope: 'dev.vite', includeDebug: true }).entries).toEqual([
      expect.objectContaining({
        level: 'error',
        scope: 'dev.vite',
        message: 'captured error',
      }),
    ])
    logs.close()
  })
})

describe('browser logger', () => {
  afterEach(() => {
    logger.connect({
      endpoint: '/logs',
      fetch: noOpFetch,
      captureConsole: false,
      captureErrors: false,
      captureRejections: false,
    })
  })

  it('sends entries with browser metadata to the configured endpoint', () => {
    const calls: Array<{ url: string; body: unknown }> = []
    logger.connect({
      endpoint: '/logs',
      scope: 'browser',
      metadata: { sessionId: 's1' },
      fetch: ((url: string, init: { body?: string }) => {
        calls.push({ url, body: JSON.parse(init.body ?? '{}') })
        return Promise.resolve({ ok: true })
      }) as typeof fetch,
      captureErrors: false,
      captureRejections: false,
    })

    logger.info('router', 'route loaded', { route: '/home' })

    expect(calls).toEqual([
      {
        url: '/logs',
        body: expect.objectContaining({
          level: 'info',
          scope: 'router',
          message: 'route loaded',
          metadata: expect.objectContaining({ sessionId: 's1' }),
          properties: { route: '/home' },
        }),
      },
    ])
  })

  it('uses explicit scopes for application entries', () => {
    const calls: Array<{ url: string; body: { scope?: string } }> = []
    const transport = ((url: string, init: { body?: string }) => {
      calls.push({ url, body: JSON.parse(init.body ?? '{}') })
      return Promise.resolve({ ok: true })
    }) as typeof fetch

    logger.connect({
      endpoint: '/logs',
      scope: 'browser',
      fetch: transport,
      captureErrors: false,
      captureRejections: false,
    })
    logger.info('router', 'loaded')

    logger.connect({
      endpoint: '/logs',
      scope: 'app',
      fetch: transport,
      captureErrors: false,
      captureRejections: false,
    })
    logger.info('router', 'reloaded')

    expect(calls.map((call) => call.body.scope)).toEqual(['router', 'router'])
  })

  it('keeps console capture idempotent across repeated connects', () => {
    const calls: Array<{ url: string; body: { message?: string } }> = []
    const originalError = console.error
    console.error = () => {}

    try {
      logger.connect({
        endpoint: '/logs',
        scope: 'browser',
        fetch: ((url: string, init: { body?: string }) => {
          calls.push({ url, body: JSON.parse(init.body ?? '{}') })
          return Promise.resolve({ ok: true })
        }) as typeof fetch,
        captureConsole: ['error'],
        captureErrors: false,
        captureRejections: false,
      })
      console.error('first')

      logger.connect({
        endpoint: '/logs',
        scope: 'browser',
        fetch: ((url: string, init: { body?: string }) => {
          calls.push({ url, body: JSON.parse(init.body ?? '{}') })
          return Promise.resolve({ ok: true })
        }) as typeof fetch,
        captureConsole: ['error'],
        captureErrors: false,
        captureRejections: false,
      })
      console.error('second')

      expect(calls.map((call) => call.body.message)).toEqual(['first', 'second'])
    } finally {
      logger.connect({
        endpoint: '/logs',
        fetch: noOpFetch,
        captureConsole: false,
        captureErrors: false,
        captureRejections: false,
      })
      console.error = originalError
    }
  })
})

const noOpFetch = (() => Promise.resolve({ ok: true } as Response)) as unknown as typeof fetch

function fakeServer() {
  const handlers = new Map<
    string,
    (req: FakeRequest, res: FakeResponse, next: () => void) => void
  >()

  return {
    middlewares: {
      use(path: string, handler: (req: FakeRequest, res: FakeResponse, next: () => void) => void) {
        handlers.set(path, handler)
      },
    },
    post(path: string, body: unknown) {
      return this.postBody(path, JSON.stringify(body))
    },
    postBody(path: string, body: string | Buffer) {
      const [mountPath, handler] =
        [...handlers].find(([mountPath]) => {
          return path === mountPath || path.startsWith(`${mountPath}/`)
        }) ?? []
      if (!handler) {
        throw new Error(`No handler for ${path}`)
      }

      const requestUrl = mountPath && path !== mountPath ? path.slice(mountPath.length) : path
      const req = new FakeRequest('POST', requestUrl)
      const res = new FakeResponse()
      handler(req, res, () => {})
      req.emit('data', body)
      req.emit('end')
      return res.done
    },
  }
}

class FakeRequest extends EventEmitter {
  readonly method: string
  readonly url: string

  constructor(method: string, url: string) {
    super()
    this.method = method
    this.url = url
  }
}

class FakeResponse {
  statusCode = 200
  done: Promise<void>
  #resolve!: () => void

  constructor() {
    this.done = new Promise((resolve) => {
      this.#resolve = resolve
    })
  }

  setHeader() {}

  end() {
    this.#resolve()
  }
}
