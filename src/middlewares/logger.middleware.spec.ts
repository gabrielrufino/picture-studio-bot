import { describe, expect, it, vi } from 'vitest'
import { logger } from '../config/logger'
import { loggerMiddleware } from './logger.middleware'

vi.mock('../config/logger', () => ({
  logger: {
    info: vi.fn(),
  },
}))

describe(loggerMiddleware.name, () => {
  it('should log user info and call next', async () => {
    const next = vi.fn()
    const ctx = { t: (key: string) => key, from: { id: 12345, first_name: 'Test' } } as any

    await loggerMiddleware(ctx, next)

    expect(logger.info).toHaveBeenCalledWith({ from: ctx.from })
    expect(next).toHaveBeenCalled()
  })
})
