import process from 'node:process'
import pino from 'pino'

export const SENSITIVE_KEYS = new Set([
  'BOT_TOKEN',
  'token',
  'apiKey',
  'Authorization',
])

const CENSOR = '[REDACTED]'

/**
 * Recursively redacts sensitive keys from a log object at any depth.
 * Unlike Pino's built-in `redact` (which relies on `fast-redact` and
 * does not support recursive wildcards), this handles arbitrarily nested objects.
 * Handles circular references via a WeakSet guard and also processes arrays.
 */
export function deepRedact(obj: Record<string, unknown>, seen: WeakSet<object> = new WeakSet()): Record<string, unknown> {
  if (seen.has(obj)) {
    return { '[Circular]': CENSOR }
  }
  seen.add(obj)

  const result: Record<string, unknown> = {}

  for (const key of Object.keys(obj)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = CENSOR
    }
    else if (Array.isArray(obj[key])) {
      result[key] = (obj[key] as unknown[]).map(item =>
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? deepRedact(item as Record<string, unknown>, seen)
          : item,
      )
    }
    else if (obj[key] !== null && typeof obj[key] === 'object') {
      result[key] = deepRedact(obj[key] as Record<string, unknown>, seen)
    }
    else {
      result[key] = obj[key]
    }
  }

  return result
}

const transport
  = process.env.NODE_ENV !== 'production'
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
        },
      })
    : undefined

export const logger = pino(
  {
    formatters: {
      log: deepRedact,
    },
  },
  transport,
)
