import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defaultStorePath, openScopedLogs } from '../src/index.js'

describe('openScopedLogs', () => {
  let dir: string
  let cwd: string
  let nodeEnv: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'leylines-node-'))
    cwd = process.cwd()
    nodeEnv = process.env.NODE_ENV
  })

  afterEach(() => {
    process.chdir(cwd)
    if (nodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = nodeEnv
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('disables logging without filesystem side effects in production', async () => {
    const path = join(dir, 'logs.sqlite')
    process.env.NODE_ENV = 'production'

    const logs = openScopedLogs({ path })
    const entry = logs.logger('app').info('ignored')

    expect(logs.enabled).toBe(false)
    expect(logs.store).toBeUndefined()
    expect(entry).toBeUndefined()
    expect(logs.query()).toEqual({ entries: [] })
    await expect(logs.tail()[Symbol.asyncIterator]().next()).resolves.toEqual({
      done: true,
      value: undefined,
    })
    expect(logs.listScopes()).toEqual([])
    expect(logs.expand('missing')).toBeUndefined()
    expect(existsSync(path)).toBe(false)
    logs.close()
  })

  it('allows production logging when explicitly enabled', () => {
    const path = join(dir, 'logs.sqlite')
    process.env.NODE_ENV = 'production'

    const logs = openScopedLogs({ path, production: true })
    const entry = logs.logger('app').info('persisted')

    expect(logs.enabled).toBe(true)
    expect(entry?.message).toBe('persisted')
    expect(logs.query().entries).toHaveLength(1)
    expect(existsSync(path)).toBe(true)
    logs.close()
  })

  it('creates scoped loggers that write through the canonical store', () => {
    const logs = openScopedLogs({ path: join(dir, 'logs.sqlite') })
    const logger = logs.logger({
      scope: 'checkout.cart',
      properties: { request: { id: 'req-1' } },
      metadata: { runtime: 'node' },
    })

    logger.info('cart opened', {
      properties: { cartId: 'cart-1', request: { attempt: 1 } },
      metadata: { pid: 123 },
    })

    expect(
      logs.query({ scope: 'checkout.cart', properties: [{ path: 'request.id', equals: 'req-1' }] })
        .entries[0],
    ).toMatchObject({
      level: 'info',
      scope: 'checkout.cart',
      message: 'cart opened',
      metadata: { runtime: 'node', pid: 123 },
      properties: {
        cartId: 'cart-1',
        request: { id: 'req-1', attempt: 1 },
      },
    })
    logs.close()
  })

  it('creates child loggers with inherited properties and nested scopes', () => {
    const logs = openScopedLogs({ path: join(dir, 'logs.sqlite') })
    const logger = logs.logger({ scope: 'worker', properties: { queue: 'email' } })
    const child = logger.child({ scope: 'job', properties: { jobId: 'job-1' } })

    child.warn('retrying')

    expect(logs.query({ includeDebug: true }).entries[0]).toMatchObject({
      level: 'warn',
      scope: 'worker.job',
      properties: { queue: 'email', jobId: 'job-1' },
    })
    logs.close()
  })

  it('uses the inferred default store path', () => {
    expect(defaultStorePath()).toBe(resolve('.leylines/logs.sqlite'))
  })

  it('adds the default store directory to local git excludes', () => {
    const repoDir = join(dir, 'repo')
    const excludePath = join(repoDir, '.git/info/exclude')
    mkdirSync(join(repoDir, '.git/info'), { recursive: true })
    writeFileSync(excludePath, '# local excludes\n')
    process.chdir(repoDir)

    openScopedLogs().close()
    const contents = readFileSync(excludePath, 'utf8')

    expect(contents).toBe('# local excludes\n.leylines/\n')

    openScopedLogs().close()
    expect(readFileSync(excludePath, 'utf8')).toBe(contents)
  })

  it('resolves git excludes through worktree gitdir files', () => {
    const worktreeDir = join(dir, 'worktree')
    const commonGitDir = join(dir, 'main.git')
    const worktreeGitDir = join(commonGitDir, 'worktrees/worktree')
    const excludePath = join(commonGitDir, 'info/exclude')
    mkdirSync(worktreeDir, { recursive: true })
    mkdirSync(worktreeGitDir, { recursive: true })
    mkdirSync(join(commonGitDir, 'info'), { recursive: true })
    writeFileSync(join(worktreeDir, '.git'), `gitdir: ${worktreeGitDir}\n`)
    writeFileSync(join(worktreeGitDir, 'commondir'), '../..\n')
    process.chdir(worktreeDir)

    openScopedLogs().close()

    expect(readFileSync(excludePath, 'utf8')).toBe('.leylines/\n')
  })

  it('delegates query, tail, expansion, scopes, and close to the store', async () => {
    const logs = openScopedLogs({ path: join(dir, 'logs.sqlite'), collapseAboveBytes: 20 })
    const controller = new AbortController()
    const next = logs
      .tail({ scope: 'app' }, { signal: controller.signal })
      [Symbol.asyncIterator]()
      .next()

    const logger = logs.logger('app')
    logger.error('failed', {
      properties: { large: 'x'.repeat(80) },
      error: new Error('boom'),
    })

    await expect(next).resolves.toMatchObject({ value: { scope: 'app', level: 'error' } })
    const entry = logs.query({ levels: ['error'] }).entries[0]
    expect(entry?.error?.message).toBe('boom')
    expect(logs.listScopes()).toEqual(['app'])
    expect(logs.expand(`${entry?.id}:properties.large`)?.value).toBe('x'.repeat(80))
    controller.abort()
    logs.close()
    expect(() => logs.query()).toThrow('Log store is closed')
  })
})
