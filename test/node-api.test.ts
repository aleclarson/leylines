import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defaultStorePath, openScopedLogs } from '../src/index.js'

describe('openScopedLogs', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'leylines-node-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
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
