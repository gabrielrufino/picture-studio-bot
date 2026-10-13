import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanTypeEnum } from '../enums/plan-type.enum'
import { userRepository } from '../repositories'
import { usageLimitMiddleware } from './usage-limit.middleware'

vi.mock('../repositories', () => ({
  userRepository: {
    findByTelegramId: vi.fn(),
    create: vi.fn(),
    incrementUsage: vi.fn(),
    updateById: vi.fn(),
  },
}))

describe(usageLimitMiddleware.name, () => {
  let next: any
  let ctx: any
  let handler: any

  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'))
    next = vi.fn()
    ctx = { t: (key: string) => key, from: { id: 12345 }, reply: vi.fn(), user: undefined }
    handler = {
      hasUsageLimits: true,
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should call next if handler does not have usage limits', async () => {
    handler.hasUsageLimits = false
    const middleware = usageLimitMiddleware(handler)

    await middleware(ctx, next)

    expect(next).toHaveBeenCalled()
    expect(userRepository.findByTelegramId).not.toHaveBeenCalled()
  })

  it('should call next if ctx.from is missing', async () => {
    delete ctx.from
    const middleware = usageLimitMiddleware(handler)

    await middleware(ctx, next)

    expect(next).toHaveBeenCalled()
    expect(userRepository.findByTelegramId).not.toHaveBeenCalled()
  })

  it('should not query db if ctx.user is present', async () => {
    const user = {
      _id: 'user-id',
      plan_type: PlanTypeEnum.Pro,
      is_blocked: false,
      daily_usage_count: 49,
      last_usage_date: '2024-01-15',
    }
    ctx.user = user as any

    const middleware = usageLimitMiddleware(handler)
    await middleware(ctx, next)

    expect(userRepository.findByTelegramId).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
  })

  it('should create user and check limit if user does not exist', async () => {
    vi.mocked(userRepository.findByTelegramId).mockResolvedValueOnce(null)
    const newUser = {
      _id: 'new-id',
      plan_type: PlanTypeEnum.Free,
      is_blocked: false,
      daily_usage_count: 0,
      last_usage_date: '2024-01-15',
    }
    vi.mocked(userRepository.create).mockResolvedValueOnce(newUser as any)

    const middleware = usageLimitMiddleware(handler)
    await middleware(ctx, next)

    expect(userRepository.create).toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
  })

  it('should block if Free user reaches limit', async () => {
    const user = {
      _id: 'user-id',
      plan_type: PlanTypeEnum.Free,
      is_blocked: false,
      daily_usage_count: 3,
      last_usage_date: '2024-01-15',
    }
    vi.mocked(userRepository.findByTelegramId).mockResolvedValueOnce(user as any)

    const middleware = usageLimitMiddleware(handler)
    await middleware(ctx, next)

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('free_limit_reached'))
    expect(next).not.toHaveBeenCalled()
  })

  it('should block if Pro user reaches limit (50)', async () => {
    const user = {
      _id: 'user-id',
      plan_type: PlanTypeEnum.Pro,
      is_blocked: false,
      daily_usage_count: 50,
      last_usage_date: '2024-01-15',
    }
    vi.mocked(userRepository.findByTelegramId).mockResolvedValueOnce(user as any)

    const middleware = usageLimitMiddleware(handler)
    await middleware(ctx, next)

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('pro_limit_reached'))
    expect(next).not.toHaveBeenCalled()
  })

  it('should allow if Pro user is within limit', async () => {
    const user = {
      _id: 'user-id',
      plan_type: PlanTypeEnum.Pro,
      is_blocked: false,
      daily_usage_count: 49,
      last_usage_date: '2024-01-15',
    }
    vi.mocked(userRepository.findByTelegramId).mockResolvedValueOnce(user as any)

    const middleware = usageLimitMiddleware(handler)
    await middleware(ctx, next)

    expect(next).toHaveBeenCalled()
  })

  it('should revert to Free if Pro plan has expired', async () => {
    const expiredDate = new Date()
    expiredDate.setDate(expiredDate.getDate() - 31)

    const user = {
      _id: 'user-id',
      plan_type: PlanTypeEnum.Pro,
      plan_started_at: expiredDate,
      is_blocked: false,
      daily_usage_count: 0,
      last_usage_date: '2024-01-15',
    }
    vi.mocked(userRepository.findByTelegramId).mockResolvedValueOnce(user as any)

    const middleware = usageLimitMiddleware(handler)
    await middleware(ctx, next)

    expect(userRepository.updateById).toHaveBeenCalledWith('user-id', {
      plan_type: PlanTypeEnum.Free,
      plan_started_at: null,
    })
    expect(next).toHaveBeenCalled()
  })

  it('should not revert to Free if Pro plan has not expired', async () => {
    const recentDate = new Date()
    recentDate.setDate(recentDate.getDate() - 15)

    const user = {
      _id: 'user-id',
      plan_type: PlanTypeEnum.Pro,
      plan_started_at: recentDate,
      is_blocked: false,
      daily_usage_count: 0,
      last_usage_date: '2024-01-15',
    }
    vi.mocked(userRepository.findByTelegramId).mockResolvedValueOnce(user as any)

    const middleware = usageLimitMiddleware(handler)
    await middleware(ctx, next)

    expect(userRepository.updateById).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
  })

  it('should block if user is blocked', async () => {
    const user = {
      _id: 'user-id',
      plan_type: PlanTypeEnum.Free,
      is_blocked: true,
      daily_usage_count: 0,
      last_usage_date: '2024-01-15',
    }
    vi.mocked(userRepository.findByTelegramId).mockResolvedValueOnce(user as any)

    const middleware = usageLimitMiddleware(handler)
    await middleware(ctx, next)

    expect(next).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalled()
  })

  it('should allow if usage count is high but last usage date is from a previous day', async () => {
    const user = {
      _id: 'user-id',
      plan_type: PlanTypeEnum.Free,
      is_blocked: false,
      daily_usage_count: 100,
      last_usage_date: '2000-01-01',
    }
    vi.mocked(userRepository.findByTelegramId).mockResolvedValueOnce(user as any)

    const middleware = usageLimitMiddleware(handler)
    await middleware(ctx, next)

    expect(next).toHaveBeenCalled()
  })

  it('should fallback to Free limits when plan_type is undefined', async () => {
    const user = {
      _id: 'user-id',
      plan_type: undefined,
      is_blocked: false,
      daily_usage_count: 3,
      last_usage_date: '2024-01-15',
    }
    vi.mocked(userRepository.findByTelegramId).mockResolvedValueOnce(user as any)

    const middleware = usageLimitMiddleware(handler)
    await middleware(ctx, next)

    expect(next).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledWith('free_limit_reached')
  })
})
