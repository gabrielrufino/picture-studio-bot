import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userRepository } from '../repositories'
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
    ctx = { t: (key: string) => key, from: { id: 12345 }, reply: vi.fn(), user: undefined }
    vi.clearAllMocks()
  })

  it('should reply and stop if from.id is missing', async () => {
    ctx.from = undefined

    await authMiddleware(ctx, next)

    expect(ctx.reply).toHaveBeenCalledWith('Unable to identify you. Access denied.')
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
})
