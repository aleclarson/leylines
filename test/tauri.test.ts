import { LogLevel as TauriPluginLogLevel } from '@tauri-apps/plugin-log'
import { logger } from '../src/browser/index.js'
import { attachTauriLogger } from '../src/tauri/index.js'

const tauriLog = vi.hoisted(() => ({
  attachLogger: vi.fn(),
  listeners: [] as Array<(record: { level: TauriPluginLogLevel; message: string }) => void>,
}))

vi.mock('@tauri-apps/plugin-log', () => ({
  LogLevel: {
    Trace: 1,
    Debug: 2,
    Info: 3,
    Warn: 4,
    Error: 5,
  },
  attachLogger: tauriLog.attachLogger,
}))

describe('tauri logger integration', () => {
  beforeEach(() => {
    tauriLog.listeners = []
    tauriLog.attachLogger.mockReset()
    tauriLog.attachLogger.mockImplementation(async (listener) => {
      tauriLog.listeners.push(listener)
      return () => {
        tauriLog.listeners = tauriLog.listeners.filter((current) => current !== listener)
      }
    })
  })

  afterEach(() => {
    logger.connect({
      endpoint: '/logs',
      fetch: (() => Promise.resolve({ ok: true } as Response)) as unknown as typeof fetch,
      captureConsole: false,
      captureErrors: false,
      captureRejections: false,
    })
  })

  it('forwards Tauri plugin-log records through the connected browser logger', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    logger.connect({
      endpoint: '/__scoped_logs',
      scope: 'browser',
      metadata: { sessionId: 's1' },
      fetch: ((url: string, init: { body?: string }) => {
        calls.push({ url, body: JSON.parse(init.body ?? '{}') })
        return Promise.resolve({ ok: true })
      }) as typeof fetch,
      captureConsole: false,
      captureErrors: false,
      captureRejections: false,
    })

    const detach = attachTauriLogger({
      scope: 'native',
      metadata: { windowLabel: 'main' },
      properties: { process: 'rust' },
    })
    await Promise.resolve()

    expect(tauriLog.attachLogger).toHaveBeenCalledTimes(1)
    tauriLog.listeners[0]?.({
      level: TauriPluginLogLevel.Trace,
      message: 'layout pass started',
    })
    tauriLog.listeners[0]?.({
      level: TauriPluginLogLevel.Error,
      message: 'command failed',
    })
    detach()

    expect(tauriLog.listeners).toEqual([])
    expect(calls.map((call) => call.url)).toEqual(['/__scoped_logs', '/__scoped_logs'])
    expect(calls.map((call) => call.body)).toEqual([
      expect.objectContaining({
        level: 'debug',
        scope: 'browser.native',
        message: 'layout pass started',
        metadata: expect.objectContaining({
          sessionId: 's1',
          windowLabel: 'main',
          source: 'tauri.log',
        }),
        properties: {
          process: 'rust',
        },
      }),
      expect.objectContaining({
        level: 'error',
        scope: 'browser.native',
        message: 'command failed',
        metadata: expect.objectContaining({
          sessionId: 's1',
          windowLabel: 'main',
          source: 'tauri.log',
        }),
        properties: {
          process: 'rust',
        },
      }),
    ])
  })

  it('cleans up when aborted before Tauri returns its unlisten function', async () => {
    let resolveAttach!: (detach: () => void) => void
    tauriLog.attachLogger.mockImplementationOnce(
      (listener) =>
        new Promise((resolve) => {
          tauriLog.listeners.push(listener)
          resolveAttach = resolve
        }),
    )

    const detach = attachTauriLogger()
    detach()
    expect(tauriLog.listeners).toHaveLength(1)

    resolveAttach(() => {
      tauriLog.listeners = []
    })
    await Promise.resolve()

    expect(tauriLog.listeners).toEqual([])
  })
})
