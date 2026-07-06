import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli } from '../src/cli.js'
import { openScopedLogs } from '../src/index.js'

describe('runCli', () => {
  let dir: string
  let storePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'leylines-cli-'))
    storePath = join(dir, 'logs.sqlite')
    const logs = openScopedLogs({ path: storePath, collapseAboveBytes: 20 })
    logs.logger({ scope: 'app.router', properties: { request: { id: 'req-1' } } }).info('route loaded')
    logs.logger('worker.queue').debug('job detail')
    logs.logger('worker.queue').error('job failed', { properties: { request: { id: 'req-1' }, payload: 'x'.repeat(80) } })
    logs.close()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('prints recent entries as a compact timeline with debug hidden by default', async () => {
    const io = memoryIO()

    await expect(runCli(['--store', storePath], io)).resolves.toBe(0)

    expect(io.stdout.text).toContain('INFO  app.router route loaded')
    expect(io.stdout.text).toContain('ERROR worker.queue job failed')
    expect(io.stdout.text).not.toContain('job detail')
  })

  it('emits stable JSON for filtered queries', async () => {
    const io = memoryIO()

    await expect(runCli([
      '--store',
      storePath,
      '--json',
      '--scope-prefix',
      'worker',
      '--level',
      'error',
      '--property',
      'request.id=req-1',
    ], io)).resolves.toBe(0)

    const output = JSON.parse(io.stdout.text) as { entries: Array<{ scope: string, level: string, message: string }> }
    expect(output.entries).toEqual([
      expect.objectContaining({ scope: 'worker.queue', level: 'error', message: 'job failed' }),
    ])
  })

  it('lists scopes and prints the active store path', async () => {
    const scopes = memoryIO()
    const path = memoryIO()

    await expect(runCli(['scopes', '--store', storePath], scopes)).resolves.toBe(0)
    await expect(runCli(['path', '--store', storePath], path)).resolves.toBe(0)

    expect(scopes.stdout.text).toBe('app.router\nworker.queue\n')
    expect(path.stdout.text).toBe(`${storePath}\n`)
  })

  it('expands collapsed values and reports absence states', async () => {
    const logs = openScopedLogs({ path: storePath })
    const entry = logs.query({ levels: ['error'] }).entries[0]
    logs.close()
    const expanded = memoryIO()
    const missing = memoryIO()

    await expect(runCli(['expand', `${entry?.id}:properties.payload`, '--store', storePath, '--json'], expanded)).resolves.toBe(0)
    await expect(runCli(['expand', 'missing', '--store', storePath], missing)).resolves.toBe(0)

    expect(JSON.parse(expanded.stdout.text)).toEqual(expect.objectContaining({ value: 'x'.repeat(80) }))
    expect(missing.stdout.text).toBe('No collapsed value matched.\n')
  })

  it('returns a clear error for unsupported arguments', async () => {
    const io = memoryIO()

    await expect(runCli(['--wat'], io)).resolves.toBe(1)

    expect(io.stderr.text).toBe('Unknown option: --wat\n')
  })
})

function memoryIO() {
  return {
    stdout: {
      text: '',
      write(chunk: string) {
        this.text += chunk
        return true
      },
    },
    stderr: {
      text: '',
      write(chunk: string) {
        this.text += chunk
        return true
      },
    },
  }
}
