import { Writable } from 'node:stream'
import pino from 'pino'
import { describe, expect, it } from 'vitest'

import { deepRedact, SENSITIVE_KEYS } from './logger'

describe('logger', () => {
  it('should redact sensitive keys at any nesting depth', () => {
    const logs: any[] = []

    const stream = new Writable({
      write(chunk, encoding, callback) {
        logs.push(JSON.parse(chunk.toString()))
        callback()
      },
    })

    const testLogger = pino(
      {
        formatters: {
          log: deepRedact,
        },
      },
      stream,
    )

    testLogger.info({
      BOT_TOKEN: 'secret1',
      nested: { BOT_TOKEN: 'secret2' },
      deep: { nested: { BOT_TOKEN: 'secret3' } },
      very: { deep: { nested: { BOT_TOKEN: 'secret4' } } },
      ultra: { very: { deep: { nested: { BOT_TOKEN: 'secret5' } } } },
      token: 'tok1',
      apiKey: 'api1',
      header: { Authorization: 'Bearer x' },
    })

    const log = logs[0]

    expect(log.BOT_TOKEN).toBe('[REDACTED]')
    expect(log.nested.BOT_TOKEN).toBe('[REDACTED]')
    expect(log.deep.nested.BOT_TOKEN).toBe('[REDACTED]')
    expect(log.very.deep.nested.BOT_TOKEN).toBe('[REDACTED]')
    expect(log.ultra.very.deep.nested.BOT_TOKEN).toBe('[REDACTED]')

    expect(log.token).toBe('[REDACTED]')
    expect(log.apiKey).toBe('[REDACTED]')
    expect(log.header.Authorization).toBe('[REDACTED]')
  })

  it('should redact at arbitrarily deep levels with no depth limit', () => {
    // Build a 10-level deep object: { a: { a: { ... { BOT_TOKEN: 'secret' } } } }
    let obj: any = { BOT_TOKEN: 'deep-secret' }
    for (let i = 0; i < 10; i++) {
      obj = { wrapper: obj }
    }

    const result = deepRedact(obj)

    // Traverse 10 levels deep
    let current: any = result
    for (let i = 0; i < 10; i++) {
      current = current.wrapper
    }
    expect(current.BOT_TOKEN).toBe('[REDACTED]')
  })

  it('should preserve non-sensitive values', () => {
    const result = deepRedact({
      username: 'gabriel',
      chat: { id: 12345, type: 'private' },
    })

    expect(result.username).toBe('gabriel')
    expect((result.chat as any).id).toBe(12345)
    expect((result.chat as any).type).toBe('private')
  })

  it('should cover all declared sensitive keys', () => {
    const input: Record<string, string> = {}
    for (const key of SENSITIVE_KEYS) {
      input[key] = `value-${key}`
    }

    const result = deepRedact(input)

    for (const key of SENSITIVE_KEYS) {
      expect(result[key]).toBe('[REDACTED]')
    }
  })

  it('should handle circular references without crashing', () => {
    const obj: any = { name: 'test', token: 'secret' }
    obj.self = obj

    const result = deepRedact(obj)

    expect(result.name).toBe('test')
    expect(result.token).toBe('[REDACTED]')
    expect(result.self).toEqual({ '[Circular]': '[REDACTED]' })
  })

  it('should redact sensitive keys inside arrays of objects', () => {
    const result = deepRedact({
      users: [
        { name: 'alice', token: 'secret1' },
        { name: 'bob', apiKey: 'secret2' },
      ],
    })

    const users = result.users as any[]
    expect(users[0].name).toBe('alice')
    expect(users[0].token).toBe('[REDACTED]')
    expect(users[1].name).toBe('bob')
    expect(users[1].apiKey).toBe('[REDACTED]')
  })

  it('should preserve arrays of primitives', () => {
    const result = deepRedact({
      tags: ['pdf', 'studio', 'bot'],
      counts: [1, 2, 3],
    })

    expect(result.tags).toEqual(['pdf', 'studio', 'bot'])
    expect(result.counts).toEqual([1, 2, 3])
  })
})
