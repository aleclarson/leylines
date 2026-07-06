import { jsonEquals, getPath } from './json.js'
import type { LogEntry, LogLevel, LogQuery } from './types.js'

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export function matchesQuery(entry: LogEntry, query: LogQuery): boolean {
  if (!query.includeDebug && !query.levels?.includes('debug') && entry.level === 'debug') {
    return false
  }

  if (query.since && entry.timestamp < toIso(query.since)) {
    return false
  }

  if (query.until && entry.timestamp > toIso(query.until)) {
    return false
  }

  if (query.levels && !query.levels.includes(entry.level)) {
    return false
  }

  if (query.minLevel && levelRank[entry.level] < levelRank[query.minLevel]) {
    return false
  }

  if (query.scope && entry.scope !== query.scope) {
    return false
  }

  if (query.scopePrefix && entry.scope !== query.scopePrefix && !entry.scope.startsWith(`${query.scopePrefix}.`)) {
    return false
  }

  if (query.text && !entry.message.includes(query.text)) {
    return false
  }

  if (query.regex) {
    const regex = typeof query.regex === 'string' ? new RegExp(query.regex) : query.regex
    if (!regex.test(entry.message)) {
      return false
    }
  }

  if (query.properties) {
    for (const filter of query.properties) {
      if (!jsonEquals(getPath(entry.properties, filter.path), filter.equals)) {
        return false
      }
    }
  }

  return true
}

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}
