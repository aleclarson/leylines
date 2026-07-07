import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLogStore } from '../src/index.js'

describe('LogStore', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'leylines-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('persists entries in stable timestamp and sequence order', () => {
    const path = join(dir, 'logs.sqlite')
    const store = openLogStore({ path })
    const first = store.write({
      id: 'first',
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'info',
      scope: 'app.router',
      message: 'route loaded',
    })
    const second = store.write({
      id: 'second',
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'warn',
      scope: 'app.router',
      message: 'route slow',
    })
    store.close()

    const reopened = openLogStore({ path })
    expect(reopened.query({ includeDebug: true }).entries.map(entry => entry.id)).toEqual([first.id, second.id])
    reopened.close()
  })

  it('filters by scope prefix, text, level, regex, and property path', () => {
    const store = openLogStore({ path: join(dir, 'logs.sqlite') })
    store.write({
      id: 'auth',
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'info',
      scope: 'auth.session',
      message: 'session created',
      properties: { request: { id: 'req-1' }, userId: 'u1' },
    })
    store.write({
      id: 'cart',
      timestamp: '2026-01-01T00:00:01.000Z',
      level: 'error',
      scope: 'checkout.cart',
      message: 'cart failed',
      properties: { request: { id: 'req-1' }, userId: 'u1' },
    })

    expect(store.query({
      scopePrefix: 'checkout',
      minLevel: 'warn',
      regex: 'failed$',
      properties: [{ path: 'request.id', equals: 'req-1' }],
    }).entries.map(entry => entry.id)).toEqual(['cart'])
    expect(store.query({ text: 'session' }).entries.map(entry => entry.id)).toEqual(['auth'])
    store.close()
  })

  it('hides debug entries by default unless requested', () => {
    const store = openLogStore({ path: join(dir, 'logs.sqlite') })
    store.write({ id: 'debug', level: 'debug', scope: 'app', message: 'hidden' })
    store.write({ id: 'info', level: 'info', scope: 'app', message: 'shown' })

    expect(store.query().entries.map(entry => entry.id)).toEqual(['info'])
    expect(store.query({ includeDebug: true }).entries.map(entry => entry.id)).toEqual(['debug', 'info'])
    expect(store.query({ levels: ['debug'] }).entries.map(entry => entry.id)).toEqual(['debug'])
    store.close()
  })

  it('redacts secret-looking properties before persistence', () => {
    const path = join(dir, 'logs.sqlite')
    const store = openLogStore({ path })
    store.write({
      id: 'secret',
      level: 'info',
      scope: 'auth',
      message: 'received token',
      properties: {
        authorization: 'Bearer abcdefghijklmnopqrstuvwxyz',
        nested: { apiKey: 'plain-secret' },
      },
    })
    store.close()

    const reopened = openLogStore({ path })
    expect(reopened.query({ includeDebug: true }).entries[0]?.properties).toEqual({
      authorization: '[REDACTED]',
      nested: { apiKey: '[REDACTED]' },
    })
    reopened.close()
  })

  it('applies retention when a store opens and closes', () => {
    const path = join(dir, 'logs.sqlite')
    const store = openLogStore({ path, retention: { maxEntries: 2 } })
    store.write({ id: 'one', timestamp: '2026-01-01T00:00:00.000Z', level: 'info', scope: 'app', message: 'one' })
    store.write({ id: 'two', timestamp: '2026-01-01T00:00:01.000Z', level: 'info', scope: 'app', message: 'two' })
    store.write({ id: 'three', timestamp: '2026-01-01T00:00:02.000Z', level: 'info', scope: 'app', message: 'three' })

    expect(store.query().entries.map(entry => entry.id)).toEqual(['one', 'two', 'three'])
    store.close()

    const reopened = openLogStore({ path, retention: { maxEntries: 10 } })
    expect(reopened.query().entries.map(entry => entry.id)).toEqual(['two', 'three'])
    reopened.close()

    const seeded = openLogStore({ path, retention: { maxEntries: 10 } })
    seeded.write({ id: 'four', timestamp: '2026-01-01T00:00:03.000Z', level: 'info', scope: 'app', message: 'four' })
    seeded.close()

    const retainedOnOpen = openLogStore({ path, retention: { maxEntries: 2 } })
    expect(retainedOnOpen.query().entries.map(entry => entry.id)).toEqual(['three', 'four'])
    retainedOnOpen.close()
  })

  it('applies retention periodically during long-running writes', () => {
    const store = openLogStore({ path: join(dir, 'logs.sqlite'), retention: { maxEntries: 2 } })
    for (let index = 0; index < 250; index += 1) {
      store.write({
        id: `entry-${index}`,
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        level: 'info',
        scope: 'app',
        message: `entry ${index}`,
      })
    }

    expect(store.query().entries.map(entry => entry.id)).toEqual(['entry-248', 'entry-249'])
    store.close()
  })

  it('paginates around stable entry boundaries', () => {
    const store = openLogStore({ path: join(dir, 'logs.sqlite') })
    store.write({ id: 'one', timestamp: '2026-01-01T00:00:00.000Z', level: 'info', scope: 'app', message: 'one' })
    store.write({ id: 'two', timestamp: '2026-01-01T00:00:01.000Z', level: 'info', scope: 'app', message: 'two' })
    store.write({ id: 'three', timestamp: '2026-01-01T00:00:02.000Z', level: 'info', scope: 'app', message: 'three' })

    expect(store.query({ limit: 2 }).entries.map(entry => entry.id)).toEqual(['one', 'two'])
    expect(store.query({ after: 'one' }).entries.map(entry => entry.id)).toEqual(['two', 'three'])
    expect(store.query({ before: 'three' }).entries.map(entry => entry.id)).toEqual(['one', 'two'])
    store.close()
  })

  it('collapses and expands large values', () => {
    const store = openLogStore({ path: join(dir, 'logs.sqlite'), collapseAboveBytes: 20 })
    const entry = store.write({
      id: 'large',
      level: 'info',
      scope: 'app',
      message: 'large payload',
      properties: { payload: { body: 'x'.repeat(80) } },
    })

    expect(entry.properties.payload).toMatchObject({
      $collapsed: true,
      id: 'properties.payload',
      path: 'properties.payload',
    })
    expect(store.expand('large:properties.payload')?.value).toEqual({ body: 'x'.repeat(80) })
    store.close()
  })

  it('tails entries after subscription', async () => {
    const store = openLogStore({ path: join(dir, 'logs.sqlite') })
    const controller = new AbortController()
    const iterator = store.tail({ scopePrefix: 'worker' }, { signal: controller.signal })[Symbol.asyncIterator]()

    const next = iterator.next()
    store.write({ id: 'skip', level: 'info', scope: 'app', message: 'skip' })
    store.write({ id: 'take', level: 'info', scope: 'worker.queue', message: 'take' })

    await expect(next).resolves.toMatchObject({ value: { id: 'take' }, done: false })
    controller.abort()
    store.close()
  })
})
