import { spawn } from 'node:child_process'
import { once } from 'node:events'
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

  it('serializes writes from multiple stores', () => {
    const path = join(dir, 'logs.sqlite')
    const first = openLogStore({ path })
    const second = openLogStore({ path })

    for (let index = 0; index < 20; index += 1) {
      const store = index % 2 === 0 ? first : second
      store.write({ id: `entry-${index}`, level: 'info', scope: 'app', message: `entry ${index}` })
    }

    expect(first.query({ includeDebug: true, limit: 20 }).entries.map(entry => entry.sequence)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    )
    first.close()
    second.close()
  })

  it('waits for transient write contention from another process', async () => {
    const path = join(dir, 'logs.sqlite')
    const store = openLogStore({ path })
    const lock = spawn(process.execPath, ['--input-type=module', '--eval', `
      import { DatabaseSync } from 'node:sqlite'
      const db = new DatabaseSync(process.argv[1])
      db.exec('PRAGMA journal_mode = WAL; BEGIN IMMEDIATE;')
      db.prepare("INSERT INTO entries (id, timestamp, level, scope, message, metadata_json, properties_json) VALUES ('other-process', '2026-01-01T00:00:00.000Z', 'info', 'dev.worker', 'written elsewhere', '{}', '{}')").run()
      process.stdout.write('locked')
      setTimeout(() => {
        db.exec('COMMIT')
        db.close()
      }, 150)
    `, path], { stdio: ['ignore', 'pipe', 'inherit'] })
    const exited = once(lock, 'exit')
    await once(lock.stdout, 'data')

    expect(() => store.write({ id: 'after-lock', level: 'info', scope: 'app', message: 'written' })).not.toThrow()
    await exited
    expect(store.query().entries.map(entry => [entry.id, entry.sequence])).toEqual([
      ['other-process', 1],
      ['after-lock', 2],
    ])
    store.close()
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
    for (let index = 0; index < 2_500; index += 1) {
      store.write({
        id: `entry-${index}`,
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        level: 'info',
        scope: 'app',
        message: `entry ${index}`,
      })
    }

    expect(store.query().entries.map(entry => entry.id)).toEqual(['entry-2498', 'entry-2499'])
    store.close()
  })

  it('paginates around stable entry boundaries', () => {
    const store = openLogStore({ path: join(dir, 'logs.sqlite') })
    store.write({ id: 'one', timestamp: '2026-01-01T00:00:00.000Z', level: 'info', scope: 'app', message: 'one' })
    store.write({ id: 'two', timestamp: '2026-01-01T00:00:01.000Z', level: 'info', scope: 'app', message: 'two' })
    store.write({ id: 'three', timestamp: '2026-01-01T00:00:02.000Z', level: 'info', scope: 'app', message: 'three' })
    store.write({ id: 'four', timestamp: '2026-01-01T00:00:03.000Z', level: 'info', scope: 'app', message: 'four' })

    expect(store.query({ limit: 2 }).entries.map(entry => entry.id)).toEqual(['three', 'four'])
    expect(store.query({ after: 'one', limit: 2 }).entries.map(entry => entry.id)).toEqual(['two', 'three'])
    expect(store.query({ before: 'four', limit: 2 }).entries.map(entry => entry.id)).toEqual(['two', 'three'])
    store.close()
  })

  it('finds the newest matches beyond the first candidate batch', () => {
    const store = openLogStore({ path: join(dir, 'logs.sqlite') })
    store.write({ id: 'match', level: 'info', scope: 'app', message: 'target', properties: { match: true } })
    for (let index = 0; index < 60; index += 1) {
      store.write({ id: `skip-${index}`, level: 'info', scope: 'app', message: 'skip' })
    }

    expect(store.query({ limit: 1, properties: [{ path: 'match', equals: true }] }).entries.map(entry => entry.id)).toEqual(['match'])
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

  it('tails entries written through another store connection', async () => {
    const path = join(dir, 'logs.sqlite')
    const reader = openLogStore({ path })
    const writer = openLogStore({ path })
    const iterator = reader.tail({ limit: 1 })[Symbol.asyncIterator]()

    const next = iterator.next()
    writer.write({ id: 'external', level: 'info', scope: 'worker', message: 'written elsewhere' })

    await expect(next).resolves.toMatchObject({ value: { id: 'external' }, done: false })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    writer.close()
    reader.close()
  })
})
