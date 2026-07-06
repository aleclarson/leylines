import { isError, isPlainObject } from 'radashi'
import type { ErrorDetails, JsonObject, JsonValue } from './types.js'

export function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return String(value)
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (isError(value)) {
    return errorDetailsToJson(toErrorDetails(value))
  }

  if (Array.isArray(value)) {
    return value.map(toJsonValue)
  }

  if (isPlainObject(value)) {
    const result: JsonObject = {}
    for (const [key, child] of Object.entries(value)) {
      result[key] = toJsonValue(child)
    }
    return result
  }

  return String(value)
}

export function toJsonObject(value: unknown): JsonObject {
  if (!isPlainObject(value)) {
    return {}
  }

  const result: JsonObject = {}
  for (const [key, child] of Object.entries(value)) {
    result[key] = toJsonValue(child)
  }
  return result
}

export function toErrorDetails(value: unknown): ErrorDetails | undefined {
  if (!value) {
    return undefined
  }

  if (isError(value)) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: value.cause === undefined ? undefined : toJsonValue(value.cause),
    }
  }

  const json = toJsonValue(value)
  if (isPlainObject(json) && !Array.isArray(json) && typeof json.message === 'string') {
    return {
      name: typeof json.name === 'string' ? json.name : undefined,
      message: json.message,
      stack: typeof json.stack === 'string' ? json.stack : undefined,
      cause: json.cause,
    }
  }

  return {
    message: String(value),
  }
}

function errorDetailsToJson(error: ErrorDetails | undefined): JsonValue {
  const result: JsonObject = {}
  if (!error) {
    return result
  }
  if (error.name !== undefined) {
    result.name = error.name
  }
  result.message = error.message
  if (error.stack !== undefined) {
    result.stack = error.stack
  }
  if (error.cause !== undefined) {
    result.cause = error.cause
  }
  return result
}

export function getPath(value: JsonValue | undefined, path: string): JsonValue | undefined {
  const parts = path.split('.').filter(Boolean)
  let current: JsonValue | undefined = value
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined
    }
    current = current[part]
  }
  return current
}

export function jsonEquals(left: JsonValue | undefined, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
