import { describe, expect, it } from 'vitest'
import { UnknownMessage } from './unknown.message'

describe(UnknownMessage.name, () => {
  const ctx = { t: (key: string) => key } as any

  it('should return a "not understood" message', () => {
    const result = new UnknownMessage(ctx).build()
    expect(result).toBe('unknown_message')
  })

  it('should return a string', () => {
    expect(new UnknownMessage(ctx).build()).toBeTypeOf('string')
  })
})
