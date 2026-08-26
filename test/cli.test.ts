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
})

function outputOf(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n')
}
