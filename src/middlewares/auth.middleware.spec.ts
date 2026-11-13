import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userRepository } from '@/repositories'
import { authMiddleware } from './auth.middleware'

vi.mock('../repositories', () => ({
  userRepository: {
    findByTelegramId: vi.fn(),
  },
}))

describe(authMiddleware.name, () => {
  let next: any
  let ctx: any

  beforeEach(() => {
    next = vi.fn()
    ctx = {
      t: (key: string) => key,
      from: { id: 12345 },
      reply: vi.fn(),
      user: undefined,
    }
    vi.clearAllMocks()
  })

  it('should reply and stop if from.id is missing', async () => {
    ctx.from = undefined

    await authMiddleware(ctx, next)

    expect(ctx.reply).toHaveBeenCalledWith('access_denied')
    expect(next).not.toHaveBeenCalled()
  })

  it('should reply and stop if user is blocked', async () => {
    vi.mocked(userRepository.findByTelegramId).mockResolvedValueOnce({
      is_blocked: true,
    } as any)

    await authMiddleware(ctx, next)

    expect(ctx.reply).toHaveBeenCalledWith('You are blocked from using this bot.')
    expect(next).not.toHaveBeenCalled()
  })

  it('should call next if user is not blocked', async () => {
    vi.mocked(userRepository.findByTelegramId).mockResolvedValueOnce({
      is_blocked: false,
    } as any)

    await authMiddleware(ctx, next)

    expect(next).toHaveBeenCalled()
    expect(ctx.reply).not.toHaveBeenCalled()
    expect(ctx.user).toEqual({ is_blocked: false })
  })

  it('should call next if user is not found in database (not blocked)', async () => {
    vi.mocked(userRepository.findByTelegramId).mockResolvedValueOnce(null)

    await authMiddleware(ctx, next)

    expect(next).toHaveBeenCalled()
    expect(ctx.reply).not.toHaveBeenCalled()
    expect(ctx.user).toBeNull()
  })

  it('should reply and stop if from.id is falsy', async () => {
    ctx.from = { id: 0 } as any

    await authMiddleware(ctx, next)

    expect(ctx.reply).toHaveBeenCalledWith('access_denied')
    expect(next).not.toHaveBeenCalled()
  })

  describe('allowed telegram ids', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('should call next for any user when the allowlist is not set', async () => {
      vi.stubEnv('ALLOWED_TELEGRAM_IDS', '')
      vi.mocked(userRepository.findByTelegramId).mockResolvedValueOnce(null)

      await authMiddleware(ctx, next)

      expect(next).toHaveBeenCalled()
      expect(ctx.reply).not.toHaveBeenCalled()
    })

    it('should call next if from.id is in the allowlist', async () => {
      vi.stubEnv('ALLOWED_TELEGRAM_IDS', '999, 12345 ,888')
      vi.mocked(userRepository.findByTelegramId).mockResolvedValueOnce(null)

      await authMiddleware(ctx, next)

      expect(next).toHaveBeenCalled()
      expect(ctx.reply).not.toHaveBeenCalled()
    })

    it('should stop silently if from.id is not in the allowlist', async () => {
      vi.stubEnv('ALLOWED_TELEGRAM_IDS', '999')

      await authMiddleware(ctx, next)

      expect(next).not.toHaveBeenCalled()
      expect(ctx.reply).not.toHaveBeenCalled()
      expect(userRepository.findByTelegramId).not.toHaveBeenCalled()
    })

    it('should answer the callback query silently if from.id is not in the allowlist', async () => {
      vi.stubEnv('ALLOWED_TELEGRAM_IDS', '999')
      ctx.callbackQuery = { id: 'cb' }
      ctx.answerCallbackQuery = vi.fn()

      await authMiddleware(ctx, next)

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith()
      expect(next).not.toHaveBeenCalled()
      expect(ctx.reply).not.toHaveBeenCalled()
    })
  })
})
