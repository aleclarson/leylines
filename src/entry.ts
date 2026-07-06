import { randomUUID } from 'node:crypto'
import { redactError, redactJson } from './redaction.js'
import { toErrorDetails, toJsonObject } from './json.js'
import type { LogEntry, LogEntryInput, RedactionOptions } from './types.ts'

export function normalizeEntry(input: LogEntryInput, sequence: number, redaction: RedactionOptions = {}): LogEntry {
  const timestamp = input.timestamp instanceof Date
    ? input.timestamp.toISOString()
    : input.timestamp ?? new Date().toISOString()

  return {
    id: input.id ?? randomUUID(),
    sequence,
    timestamp,
    level: input.level,
    scope: input.scope,
    message: input.message,
    metadata: redactJson(toJsonObject(input.metadata), redaction) as ReturnType<typeof toJsonObject>,
    properties: redactJson(toJsonObject(input.properties), redaction) as ReturnType<typeof toJsonObject>,
    error: redactError(toErrorDetails(input.error), redaction),
  }
}
