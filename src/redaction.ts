import { isPlainObject } from 'radashi'
import type { ErrorDetails, JsonObject, JsonValue, RedactionOptions, RedactionRule } from './types.js'

const defaultSecretName = /(^|[_\-.])(password|passwd|pwd|secret|token|api[_\-.]?key|authorization|credential|cookie|session)([_\-.]|$)/i
const defaultSecretValue = /\b(?:bearer\s+[a-z0-9._~+/=-]{12,}|(?:sk|pk|api)_[a-z0-9_=-]{16,})\b/i
const defaultReplacement = '[REDACTED]'

const defaultRules: RedactionRule[] = [
  { name: defaultSecretName },
  { value: defaultSecretValue },
]

export function redactJson(value: JsonValue, options: RedactionOptions = {}, path: string[] = []): JsonValue {
  if (isPlainObject(value)) {
    const result: JsonObject = {}
    for (const [key, child] of Object.entries(value)) {
      result[key] = shouldRedact(key, child, options) ? replacementFor(key, child, options) : redactJson(child, options, [...path, key])
    }
    return result
  }

  if (Array.isArray(value)) {
    return value.map((child, index) => redactJson(child, options, [...path, String(index)]))
  }

  return shouldRedact(path.at(-1), value, options) ? replacementFor(path.at(-1), value, options) : value
}

export function redactError(error: ErrorDetails | undefined, options: RedactionOptions = {}): ErrorDetails | undefined {
  if (!error) {
    return undefined
  }

  return {
    ...error,
    message: redactString(error.message, options),
    stack: error.stack ? redactString(error.stack, options) : undefined,
    cause: error.cause === undefined ? undefined : redactJson(error.cause, options),
  }
}

function shouldRedact(name: string | undefined, value: JsonValue, options: RedactionOptions): boolean {
  return [...defaultRules, ...(options.rules ?? [])].some(rule => {
    if (name !== undefined && rule.name) {
      if (typeof rule.name === 'string' ? rule.name === name : rule.name.test(name)) {
        return true
      }
    }

    if (typeof value === 'string' && rule.value) {
      return typeof rule.value === 'string' ? value.includes(rule.value) : rule.value.test(value)
    }

    return false
  })
}

function replacementFor(name: string | undefined, value: JsonValue, options: RedactionOptions): string {
  const rule = [...(options.rules ?? []), ...defaultRules].find(candidate => {
    const nameMatches = name !== undefined && candidate.name
      ? typeof candidate.name === 'string' ? candidate.name === name : candidate.name.test(name)
      : false
    const valueMatches = typeof value === 'string' && candidate.value
      ? typeof candidate.value === 'string' ? value.includes(candidate.value) : candidate.value.test(value)
      : false
    return nameMatches || valueMatches
  })
  return rule?.replacement ?? defaultReplacement
}

function redactString(value: string, options: RedactionOptions): string {
  let result = value
  for (const rule of [...defaultRules, ...(options.rules ?? [])]) {
    if (!rule.value) {
      continue
    }
    result = typeof rule.value === 'string'
      ? result.split(rule.value).join(rule.replacement ?? defaultReplacement)
      : result.replace(rule.value, rule.replacement ?? defaultReplacement)
  }
  return result
}
