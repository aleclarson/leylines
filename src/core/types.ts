export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type JsonPrimitive = string | number | boolean | null

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

export interface ErrorDetails {
  name?: string
  message: string
  stack?: string
  cause?: JsonValue
}

export interface LogEntry {
  id: string
  sequence: number
  timestamp: string
  level: LogLevel
  scope: string
  message: string
  metadata: JsonObject
  properties: JsonObject
  error?: ErrorDetails
}

export interface LogEntryInput {
  id?: string
  timestamp?: Date | string
  level: LogLevel
  scope: string
  message: string
  metadata?: JsonObject
  properties?: JsonObject
  error?: unknown
}

export interface PropertyFilter {
  path: string
  equals: JsonValue
}

export interface LogQuery {
  since?: Date | string
  until?: Date | string
  before?: string
  after?: string
  levels?: LogLevel[]
  minLevel?: LogLevel
  scope?: string
  scopePrefix?: string
  text?: string
  regex?: string | RegExp
  properties?: PropertyFilter[]
  includeDebug?: boolean
  limit?: number
}

export interface LogPage {
  entries: LogEntry[]
  nextBefore?: string
  nextAfter?: string
}

export interface RetentionOptions {
  maxEntries?: number
  maxAgeMs?: number
}

export interface RedactionRule {
  name?: string | RegExp
  value?: string | RegExp
  replacement?: string
}

export interface RedactionOptions {
  rules?: RedactionRule[]
}

export interface CollapsedValue {
  id: string
  entryId: string
  path: string
  value: JsonValue
}
