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

  if (query.fuzzy?.some((term) => !matchesFuzzyTerm(entry, term))) {
    return false
  }

  return true
}

function matchesFuzzyTerm(entry: LogEntry, term: string): boolean {
  const exclude = term.startsWith('!')
  const pattern = exclude ? term.slice(1) : term
  const target = pattern.includes('.')
    ? entry.scope
    : [
        entry.level,
        entry.scope,
        entry.message,
        JSON.stringify(entry.metadata),
        JSON.stringify(entry.properties),
        entry.error ? JSON.stringify(entry.error) : '',
      ].join(' ')
  const matches = pattern.includes('.')
    ? scopePattern(pattern).test(target)
    : wordPattern(pattern).test(target)
  return exclude ? !matches : matches
}

function scopePattern(pattern: string): RegExp {
  const source = pattern
    .split('*')
    .map((part) => escapeRegExp(part))
    .join('.*')
  return new RegExp(`^${source}$`, 'iu')
}

function wordPattern(pattern: string): RegExp {
  const startsWithWildcard = pattern.startsWith('*')
  const endsWithWildcard = pattern.endsWith('*')
  const word = pattern.slice(startsWithWildcard ? 1 : 0, endsWithWildcard ? -1 : undefined)
  const wordCharacter = '[\\p{L}\\p{N}_]'
  const before = startsWithWildcard ? `${wordCharacter}*` : `(?<!${wordCharacter})`
  const after = endsWithWildcard ? `${wordCharacter}*` : `(?!${wordCharacter})`
  return new RegExp(`${before}${escapeRegExp(word)}${after}`, 'iu')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}
