#!/usr/bin/env node
import { inspect } from 'node:util'
import {
  array,
  binary,
  command,
  extendType,
  flag,
  multioption,
  number,
  oneOf,
  option,
  optional,
  positional,
  run,
  string,
  subcommands,
  type Type,
} from 'cmd-ts'
import { defaultStorePath, openScopedLogs } from '../node/index.js'
import type { JsonValue, LogEntry, LogLevel, LogQuery, PropertyFilter } from '../core/types.js'

type QueryArgs = {
  json: boolean
  pretty: boolean
  includeDebug: boolean
  limit?: number
  since?: string
  until?: string
  before?: string
  after?: string
  levels?: LogLevel[]
  minLevel?: LogLevel
  scope?: string
  scopePrefix?: string
  text?: string
  regex?: string
  properties: PropertyFilter[]
}

const commands = new Set(['recent', 'tail', 'scopes', 'expand', 'path'])
const helpFlags = new Set(['--help', '-h'])

const LogLevelType = oneOf(['debug', 'info', 'warn', 'error'] as const)

const PositiveInteger = extendType(number, {
  displayName: 'count',
  description: 'A positive integer',
  async from(value) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error('Value must be a positive integer')
    }
    return value
  },
})

const LogLevels: Type<string, LogLevel[]> = {
  displayName: 'levels',
  description: 'Comma-separated log levels',
  async from(value) {
    const parsed: LogLevel[] = []
    for (const level of value.split(',')) {
      parsed.push(await LogLevelType.from(level))
    }
    return parsed
  },
}

const PropertyFilterType: Type<string, PropertyFilter> = {
  displayName: 'path=value',
  description: 'Property equality filter',
  async from(value) {
    const index = value.indexOf('=')
    if (index === -1) {
      throw new Error('Property filters must use path=value')
    }

    return {
      path: value.slice(0, index),
      equals: parseJsonValue(value.slice(index + 1)),
    }
  },
}

const queryArgs = {
  json: flag({
    long: 'json',
    description: 'Emit machine-readable JSON',
    defaultValue: () => false,
  }),
  pretty: flag({
    long: 'pretty',
    description: 'Emit spacious, styled output for human reading',
    defaultValue: () => false,
  }),
  includeDebug: flag({
    long: 'include-debug',
    description: 'Include debug entries in default queries',
    defaultValue: () => false,
  }),
  limit: option({
    type: optional(PositiveInteger),
    long: 'limit',
    description: 'Maximum number of entries to print',
  }),
  since: option({
    type: optional(string),
    long: 'since',
    description: 'Include entries at or after this timestamp',
  }),
  until: option({
    type: optional(string),
    long: 'until',
    description: 'Include entries at or before this timestamp',
  }),
  before: option({
    type: optional(string),
    long: 'before',
    description: 'Include entries before this entry id',
  }),
  after: option({
    type: optional(string),
    long: 'after',
    description: 'Include entries after this entry id',
  }),
  levels: option({
    type: optional(LogLevels),
    long: 'level',
    description: 'Exact level filter, or comma-separated levels',
  }),
  minLevel: option({
    type: optional(LogLevelType),
    long: 'min-level',
    description: 'Minimum log level to include',
  }),
  scope: option({
    type: optional(string),
    long: 'scope',
    description: 'Exact scope filter',
  }),
  scopePrefix: option({
    type: optional(string),
    long: 'scope-prefix',
    description: 'Scope prefix filter',
  }),
  text: option({
    type: optional(string),
    long: 'text',
    description: 'Message substring filter',
  }),
  regex: option({
    type: optional(string),
    long: 'regex',
    description: 'Message regular expression filter',
  }),
  properties: multioption({
    type: array(PropertyFilterType),
    long: 'property',
    description: 'Property equality filter; may be repeated',
    defaultValue: () => [],
  }),
}

const recentCommand = command({
  name: 'recent',
  description: 'Print recent log entries',
  args: queryArgs,
  handler(args) {
    const format = outputFormat(args)
    const logs = openCliLogs()
    try {
      writeEntries(logs.query(toQuery(args)).entries, format)
    } finally {
      logs.close()
    }
  },
})

const tailCommand = command({
  name: 'tail',
  description: 'Print new log entries as they are appended',
  args: queryArgs,
  async handler(args) {
    const format = outputFormat(args)
    const logs = openCliLogs()
    const controller = new AbortController()
    const stop = () => controller.abort()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    try {
      for await (const entry of logs.tail(toQuery(args), { signal: controller.signal })) {
        writeEntries([entry], format)
      }
    } finally {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
      logs.close()
    }
  },
})

const scopesCommand = command({
  name: 'scopes',
  description: 'List observed scopes',
  args: {
    json: queryArgs.json,
  },
  handler({ json }) {
    const logs = openCliLogs()
    try {
      const scopes = logs.listScopes()
      process.stdout.write(
        json
          ? `${JSON.stringify({ scopes })}\n`
          : `${scopes.join('\n')}${scopes.length ? '\n' : ''}`,
      )
    } finally {
      logs.close()
    }
  },
})

const expandCommand = command({
  name: 'expand',
  description: 'Print a collapsed value by id',
  args: {
    id: positional({
      type: string,
      displayName: 'collapsed-id',
      description: 'Collapsed value identifier',
    }),
    json: queryArgs.json,
  },
  handler({ id, json }) {
    const logs = openCliLogs()
    try {
      const value = logs.expand(id)
      if (!value) {
        process.stdout.write(
          json ? `${JSON.stringify({ value: null })}\n` : 'No collapsed value matched.\n',
        )
        return
      }

      process.stdout.write(
        json
          ? `${JSON.stringify(value)}\n`
          : `${inspect(value.value, { colors: false, depth: null })}\n`,
      )
    } finally {
      logs.close()
    }
  },
})

// Inspection remains available for stores intentionally captured from production processes.
function openCliLogs() {
  return openScopedLogs({ production: true, test: true })
}

const pathCommand = command({
  name: 'path',
  description: 'Print the active store path',
  args: {},
  handler() {
    process.stdout.write(`${defaultStorePath()}\n`)
  },
})

const cli = subcommands({
  name: 'leylines',
  description: 'Inspect local scoped logs',
  cmds: {
    recent: recentCommand,
    tail: tailCommand,
    scopes: scopesCommand,
    expand: expandCommand,
    path: pathCommand,
  },
})

/** Run the Leylines command-line interface with an optional argv override. */
export async function runCli(argv: string[] = process.argv): Promise<void> {
  await run(binary(cli), normalizeArgv(argv))
}

function normalizeArgv(argv: string[]): string[] {
  const [execPath = 'node', scriptPath = 'leylines', ...args] =
    argv.length >= 2 ? argv : ['node', 'leylines', ...argv]
  const first = args[0]
  if (!first) {
    return [execPath, scriptPath, 'recent']
  }
  if (commands.has(first) || helpFlags.has(first)) {
    return [execPath, scriptPath, ...args]
  }
  if (first.startsWith('-')) {
    return [execPath, scriptPath, 'recent', ...args]
  }
  return [execPath, scriptPath, ...args]
}

function toQuery(args: QueryArgs): LogQuery {
  return {
    includeDebug: args.includeDebug,
    limit: args.limit,
    since: args.since,
    until: args.until,
    before: args.before,
    after: args.after,
    levels: args.levels,
    minLevel: args.minLevel,
    scope: args.scope,
    scopePrefix: args.scopePrefix,
    text: args.text,
    regex: args.regex,
    properties: args.properties.length ? args.properties : undefined,
  }
}

type OutputFormat = 'compact' | 'json' | 'pretty'

function outputFormat(args: Pick<QueryArgs, 'json' | 'pretty'>): OutputFormat {
  if (args.json && args.pretty) {
    throw new Error('--json and --pretty cannot be used together')
  }
  return args.json ? 'json' : args.pretty ? 'pretty' : 'compact'
}

function writeEntries(entries: LogEntry[], format: OutputFormat): void {
  if (format === 'json') {
    process.stdout.write(`${JSON.stringify({ entries })}\n`)
    return
  }

  if (!entries.length) {
    process.stdout.write('No entries matched.\n')
    return
  }

  for (const entry of entries) {
    if (format === 'pretty') {
      process.stdout.write(formatPrettyEntry(entry))
      continue
    }
    process.stdout.write(
      `${entry.timestamp} ${entry.level.toUpperCase().padEnd(5)} ${entry.scope} ${entry.message}${formatProperties(entry)}\n`,
    )
  }
}

const prettyLevel = {
  debug: { symbol: '.', color: 90 },
  info: { symbol: 'i', color: 36 },
  warn: { symbol: '!', color: 33 },
  error: { symbol: 'x', color: 31 },
} as const

function formatPrettyEntry(entry: LogEntry): string {
  const level = prettyLevel[entry.level]
  const color = (text: string) => ansi(level.color, text)
  const lines = [
    `${color(level.symbol)}  ${ansi(2, prettyTimestamp(entry.timestamp))}  ${ansi(2, entry.scope)}`,
    `   ${ansi(1, entry.message)}`,
  ]

  for (const [key, value] of Object.entries(entry.properties)) {
    lines.push(...formatPrettyField(key, value))
  }

  if (entry.error) {
    const name = entry.error.name ?? 'Error'
    lines.push(`   ${color(`${name}: ${entry.error.message}`)}`)
    if (entry.error.stack) {
      const stackLines = entry.error.stack.split('\n')
      const firstLineRepeatsMessage = stackLines[0]?.includes(entry.error.message)
      for (const line of firstLineRepeatsMessage ? stackLines.slice(1) : stackLines) {
        lines.push(`   ${ansi(2, line)}`)
      }
    }
    if (entry.error.cause !== undefined) {
      lines.push(...formatPrettyField('cause', entry.error.cause))
    }
  }

  return `${lines.join('\n')}\n\n`
}

function formatPrettyField(key: string, value: JsonValue): string[] {
  const formatted = JSON.stringify(value, null, 2) ?? 'null'
  const [first = '', ...rest] = formatted.split('\n')
  return [`   ${ansi(2, `${key}:`)} ${first}`, ...rest.map((line) => `   ${line}`)]
}

function prettyTimestamp(timestamp: string): string {
  if (!process.stdout.isTTY) {
    return timestamp
  }

  const date = new Date(timestamp)
  if (Number.isNaN(date.valueOf())) {
    return timestamp
  }
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`
}

function ansi(code: number, text: string): string {
  return process.stdout.isTTY && process.env.NO_COLOR === undefined
    ? `\u001B[${code}m${text}\u001B[0m`
    : text
}

function formatProperties(entry: LogEntry): string {
  const properties = Object.keys(entry.properties).length
    ? ` props=${JSON.stringify(entry.properties)}`
    : ''
  const error = entry.error ? ` error=${JSON.stringify(entry.error)}` : ''
  return `${properties}${error}`
}

function parseJsonValue(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue
  } catch {
    return value
  }
}

if (import.meta.main) {
  await runCli(process.argv)
}
