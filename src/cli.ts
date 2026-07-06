#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'
import { defaultStorePath, openScopedLogs } from './node.js'
import type { JsonValue, LogEntry, LogLevel, LogQuery, PropertyFilter } from './types.js'

interface CliIO {
  stdout: Pick<NodeJS.WriteStream, 'write'>
  stderr: Pick<NodeJS.WriteStream, 'write'>
}

interface CliOptions {
  command: 'recent' | 'tail' | 'scopes' | 'expand' | 'path'
  storePath?: string
  json: boolean
  expandId?: string
  query: LogQuery
}

const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']

export async function runCli(argv: string[], io: CliIO = { stdout: process.stdout, stderr: process.stderr }): Promise<number> {
  let options: CliOptions
  try {
    options = parseArgs(argv)
  }
  catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }

  if (options.command === 'path') {
    io.stdout.write(`${options.storePath ?? defaultStorePath()}\n`)
    return 0
  }

  const logs = openScopedLogs({ path: options.storePath })
  try {
    switch (options.command) {
      case 'recent': {
        const page = logs.query(options.query)
        writeEntries(page.entries, options.json, io)
        return 0
      }
      case 'scopes': {
        const scopes = logs.listScopes()
        io.stdout.write(options.json ? `${JSON.stringify({ scopes })}\n` : `${scopes.join('\n')}${scopes.length ? '\n' : ''}`)
        return 0
      }
      case 'expand': {
        if (!options.expandId) {
          throw new Error('expand requires a collapsed value id')
        }
        const value = logs.expand(options.expandId)
        if (!value) {
          io.stdout.write(options.json ? `${JSON.stringify({ value: null })}\n` : 'No collapsed value matched.\n')
          return 0
        }
        io.stdout.write(options.json ? `${JSON.stringify(value)}\n` : `${inspect(value.value, { colors: false, depth: null })}\n`)
        return 0
      }
      case 'tail': {
        for await (const entry of logs.tail(options.query)) {
          writeEntries([entry], options.json, io)
        }
        return 0
      }
    }
  }
  finally {
    logs.close()
  }
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv]
  const first = args[0]
  const command = first && !first.startsWith('-') ? args.shift() : 'recent'
  if (command !== 'recent' && command !== 'tail' && command !== 'scopes' && command !== 'expand' && command !== 'path') {
    throw new Error(`Unknown command: ${command}`)
  }

  const query: LogQuery = {}
  let storePath: string | undefined
  let json = false
  let expandId: string | undefined

  while (args.length) {
    const flag = args.shift()
    if (!flag) {
      break
    }

    switch (flag) {
      case '--store':
        storePath = readValue(flag, args)
        break
      case '--json':
        json = true
        break
      case '--include-debug':
        query.includeDebug = true
        break
      case '--limit':
        query.limit = Number(readValue(flag, args))
        if (!Number.isInteger(query.limit) || query.limit <= 0) {
          throw new Error('--limit must be a positive integer')
        }
        break
      case '--since':
        query.since = readValue(flag, args)
        break
      case '--until':
        query.until = readValue(flag, args)
        break
      case '--before':
        query.before = readValue(flag, args)
        break
      case '--after':
        query.after = readValue(flag, args)
        break
      case '--level':
        query.levels = readLevels(readValue(flag, args))
        break
      case '--min-level':
        query.minLevel = readLevel(readValue(flag, args))
        break
      case '--scope':
        query.scope = readValue(flag, args)
        break
      case '--scope-prefix':
        query.scopePrefix = readValue(flag, args)
        break
      case '--text':
        query.text = readValue(flag, args)
        break
      case '--regex':
        query.regex = readValue(flag, args)
        break
      case '--property':
        query.properties = [...(query.properties ?? []), readPropertyFilter(readValue(flag, args))]
        break
      default:
        if (command === 'expand' && !expandId) {
          expandId = flag
          break
        }
        throw new Error(`Unknown option: ${flag}`)
    }
  }

  return { command, storePath, json, expandId, query }
}

function writeEntries(entries: LogEntry[], json: boolean, io: CliIO): void {
  if (json) {
    io.stdout.write(`${JSON.stringify({ entries })}\n`)
    return
  }

  if (!entries.length) {
    io.stdout.write('No entries matched.\n')
    return
  }

  for (const entry of entries) {
    io.stdout.write(`${entry.timestamp} ${entry.level.toUpperCase().padEnd(5)} ${entry.scope} ${entry.message}${formatProperties(entry)}\n`)
  }
}

function formatProperties(entry: LogEntry): string {
  const properties = Object.keys(entry.properties).length ? ` props=${JSON.stringify(entry.properties)}` : ''
  const error = entry.error ? ` error=${JSON.stringify(entry.error)}` : ''
  return `${properties}${error}`
}

function readValue(flag: string, args: string[]): string {
  const value = args.shift()
  if (!value) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function readLevels(value: string): LogLevel[] {
  return value.split(',').map(readLevel)
}

function readLevel(value: string): LogLevel {
  if (!levels.includes(value as LogLevel)) {
    throw new Error(`Unsupported level: ${value}`)
  }
  return value as LogLevel
}

function readPropertyFilter(value: string): PropertyFilter {
  const index = value.indexOf('=')
  if (index === -1) {
    throw new Error('--property must use path=value')
  }

  return {
    path: value.slice(0, index),
    equals: parseJsonValue(value.slice(index + 1)),
  }
}

function parseJsonValue(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue
  }
  catch {
    return value
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await runCli(process.argv.slice(2))
}
