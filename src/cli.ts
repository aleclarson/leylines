#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
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
import { defaultStorePath, openScopedLogs } from './node.js'
import type { JsonValue, LogEntry, LogLevel, LogQuery, PropertyFilter } from './types.js'

type QueryArgs = {
  storePath?: string
  json: boolean
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
  storePath: option({
    type: optional(string),
    long: 'store',
    env: 'SCOPED_LOGS_STORE',
    description: 'Path to the SQLite log store',
  }),
  json: flag({
    long: 'json',
    description: 'Emit machine-readable JSON',
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
    const logs = openScopedLogs({ path: args.storePath })
    try {
      writeEntries(logs.query(toQuery(args)).entries, args.json)
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
    const logs = openScopedLogs({ path: args.storePath })
    try {
      for await (const entry of logs.tail(toQuery(args))) {
        writeEntries([entry], args.json)
      }
    } finally {
      logs.close()
    }
  },
})

const scopesCommand = command({
  name: 'scopes',
  description: 'List observed scopes',
  args: {
    storePath: queryArgs.storePath,
    json: queryArgs.json,
  },
  handler({ storePath, json }) {
    const logs = openScopedLogs({ path: storePath })
    try {
      const scopes = logs.listScopes()
      process.stdout.write(json ? `${JSON.stringify({ scopes })}\n` : `${scopes.join('\n')}${scopes.length ? '\n' : ''}`)
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
    storePath: queryArgs.storePath,
    json: queryArgs.json,
  },
  handler({ id, storePath, json }) {
    const logs = openScopedLogs({ path: storePath })
    try {
      const value = logs.expand(id)
      if (!value) {
        process.stdout.write(json ? `${JSON.stringify({ value: null })}\n` : 'No collapsed value matched.\n')
        return
      }

      process.stdout.write(json ? `${JSON.stringify(value)}\n` : `${inspect(value.value, { colors: false, depth: null })}\n`)
    } finally {
      logs.close()
    }
  },
})

const pathCommand = command({
  name: 'path',
  description: 'Print the active store path',
  args: {
    storePath: queryArgs.storePath,
  },
  handler({ storePath }) {
    process.stdout.write(`${storePath ?? defaultStorePath()}\n`)
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

export async function runCli(argv: string[] = process.argv): Promise<void> {
  await run(binary(cli), normalizeArgv(argv))
}

function normalizeArgv(argv: string[]): string[] {
  const [execPath = 'node', scriptPath = 'leylines', ...args] = argv.length >= 2 ? argv : ['node', 'leylines', ...argv]
  const first = args[0]
  return first && commands.has(first) ? [execPath, scriptPath, ...args] : [execPath, scriptPath, 'recent', ...args]
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

function writeEntries(entries: LogEntry[], json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify({ entries })}\n`)
    return
  }

  if (!entries.length) {
    process.stdout.write('No entries matched.\n')
    return
  }

  for (const entry of entries) {
    process.stdout.write(`${entry.timestamp} ${entry.level.toUpperCase().padEnd(5)} ${entry.scope} ${entry.message}${formatProperties(entry)}\n`)
  }
}

function formatProperties(entry: LogEntry): string {
  const properties = Object.keys(entry.properties).length ? ` props=${JSON.stringify(entry.properties)}` : ''
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runCli(process.argv)
}
