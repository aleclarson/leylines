import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli } from '../src/cli/index.js'
import { openLogStore } from '../src/index.js'

describe('runCli', () => {
  const exitMessage = 'process.exit called'

  let log: ReturnType<typeof vi.spyOn>
  let error: ReturnType<typeof vi.spyOn>
  let exit: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
    exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error(exitMessage)
    })
  })

  afterEach(() => {
    log.mockRestore()
    error.mockRestore()
    exit.mockRestore()
  })

  it('prints subcommands for top-level help', async () => {
    await expect(runCli(['node', 'ley', '--help'])).rejects.toThrow(exitMessage)

    const output = outputOf(log)
    expect(output).toContain('leylines <subcommand>')
    expect(output).toContain('where <subcommand> can be one of:')
    expect(output).toContain('- recent - Print recent log entries')
    expect(output).toContain('- tail - Print new log entries as they are appended')
    expect(output).toContain('- scopes - List observed scopes')
    expect(output).toContain('- expand - Print a collapsed value by id')
    expect(output).toContain('- path - Print the active store path')
  })

  it('keeps option-only invocations on the recent command', async () => {
    await expect(runCli(['node', 'ley', '--limit', '1', '--help'])).rejects.toThrow(exitMessage)

    const output = outputOf(log)
    expect(output).toContain('leylines recent')
    expect(output).toContain('--limit <count>')
    expect(output).toContain('--pretty')
  })

  it('prints the most recent matching entries in chronological order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'leylines-cli-'))
    const cwd = process.cwd()
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    try {
      process.chdir(dir)
      const store = openLogStore({ path: join(dir, '.leylines/logs.sqlite') })
      store.write({
        id: 'one',
        timestamp: '2026-01-01T00:00:00.000Z',
        level: 'info',
        scope: 'app',
        message: 'one',
      })
      store.write({
        id: 'two',
        timestamp: '2026-01-01T00:00:01.000Z',
        level: 'info',
        scope: 'app',
        message: 'two',
      })
      store.write({
        id: 'three',
        timestamp: '2026-01-01T00:00:02.000Z',
        level: 'info',
        scope: 'app',
        message: 'three',
      })
      store.close()

      await runCli(['node', 'ley', 'recent', '--limit', '2', '--json'])

      const output = write.mock.calls.map((call) => call[0]).join('')
      expect(JSON.parse(output).entries.map((entry: { id: string }) => entry.id)).toEqual([
        'two',
        'three',
      ])
    } finally {
      write.mockRestore()
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prints spacious entries with --pretty', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'leylines-cli-'))
    const cwd = process.cwd()
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    try {
      process.chdir(dir)
      const store = openLogStore({ path: join(dir, '.leylines/logs.sqlite') })
      store.write({
        id: 'payment',
        timestamp: '2026-01-01T00:00:00.000Z',
        level: 'warn',
        scope: 'checkout.payment',
        message: 'Payment needs attention',
        properties: { order: { id: 'ord_123' }, attempts: 2 },
      })
      store.close()

      await runCli(['node', 'ley', 'recent', '--pretty'])

      const output = write.mock.calls.map((call) => call[0]).join('')
      expect(output).toBe(
        [
          '!  2026-01-01T00:00:00.000Z  checkout.payment',
          '   Payment needs attention',
          '   order: {',
          '     "id": "ord_123"',
          '   }',
          '   attempts: 2',
          '',
          '',
        ].join('\n'),
      )
      expect(output).not.toContain('\u001B[')
    } finally {
      write.mockRestore()
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('styles pretty entries only when writing to a color terminal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'leylines-cli-'))
    const cwd = process.cwd()
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const isTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    const noColor = process.env.NO_COLOR

    try {
      process.chdir(dir)
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
      delete process.env.NO_COLOR
      const store = openLogStore({ path: join(dir, '.leylines/logs.sqlite') })
      store.write({
        timestamp: '2026-01-01T00:00:00.000Z',
        level: 'error',
        scope: 'checkout.payment',
        message: 'Payment failed',
      })
      store.close()

      await runCli(['node', 'ley', 'recent', '--pretty'])

      const output = write.mock.calls.map((call) => call[0]).join('')
      expect(output).toContain('\u001B[31mx\u001B[0m')
      expect(output).toContain('\u001B[1mPayment failed\u001B[0m')
      expect(output).not.toContain('2026-01-01T00:00:00.000Z')
    } finally {
      if (isTTY) {
        Object.defineProperty(process.stdout, 'isTTY', isTTY)
      } else {
        delete (process.stdout as { isTTY?: boolean }).isTTY
      }
      if (noColor === undefined) {
        delete process.env.NO_COLOR
      } else {
        process.env.NO_COLOR = noColor
      }
      write.mockRestore()
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects combining --pretty with --json', async () => {
    await expect(runCli(['node', 'ley', 'recent', '--pretty', '--json'])).rejects.toThrow(
      '--json and --pretty cannot be used together',
    )
  })

  it('tails writes from another connection and stops at the limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'leylines-cli-'))
    const cwd = process.cwd()
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    try {
      process.chdir(dir)
      const sigintListeners = process.listenerCount('SIGINT')
      const tail = runCli(['node', 'ley', 'tail', '--limit', '2', '--json'])
      await vi.waitFor(() =>
        expect(process.listenerCount('SIGINT')).toBeGreaterThan(sigintListeners),
      )
      const store = openLogStore({ path: join(dir, '.leylines/logs.sqlite') })
      store.write({ id: 'one', level: 'info', scope: 'app', message: 'one' })
      store.write({ id: 'two', level: 'info', scope: 'app', message: 'two' })
      store.close()

      await tail

      const entries = write.mock.calls.map(
        (call) => JSON.parse(String(call[0])).entries[0] as { id: string },
      )
      expect(entries.map((entry) => entry.id)).toEqual(['one', 'two'])
    } finally {
      write.mockRestore()
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function outputOf(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n')
}
