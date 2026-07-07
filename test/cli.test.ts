import { runCli } from '../src/cli/index.js'

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
})

function outputOf(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n')
}
