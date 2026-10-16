import type { UserRepository } from '@/repositories/user.repository'
import type { CustomContext } from '@/types/custom-context.type'
import fs from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DAILY_LIMITS, MAX_FILE_SIZE, MAX_PRO_FILE_SIZE } from '@/config/constants'
import { CommandEnum } from '@/enums/command.enum'
import { PlanTypeEnum } from '@/enums/plan-type.enum'
import { LimitExceededError } from '@/errors/limit-exceeded.error'
import { BaseHandler } from './base.handler'

describe(BaseHandler.name, () => {
  class TestHandler extends BaseHandler {
    readonly command = CommandEnum.Test
    readonly description = 'Test command'
    readonly events = {}
    async onCommand() {}

    // Expose protected methods for testing
    public async setSessionCommand(ctx: CustomContext) {
      await super.setSessionCommand(ctx)
    }

    public async resetSession(ctx: CustomContext) {
      await super.resetSession(ctx)
    }

    public async notifyLimitExceeded(ctx: CustomContext) {
      await super.notifyLimitExceeded(ctx)
    }

    public async checkLimits(ctx: CustomContext, options: { fileSize?: number }) {
      await super.checkLimits(ctx, options)
    }

    public async incrementUsage(ctx: CustomContext, userRepository: UserRepository) {
      return super.incrementUsage(ctx, userRepository)
    }

    public async decrementUsage(ctx: CustomContext, userRepository: UserRepository) {
      return super.decrementUsage(ctx, userRepository)
    }

    public async runWithUsage(
      ctx: CustomContext,
      userRepository: UserRepository,
      action: (markDelivered: () => void) => Promise<void>,
    ) {
      return super.runWithUsage(ctx, userRepository, action)
    }
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should set session command correctly', async () => {
    const handler = new TestHandler()
    const ctx: any = { t: (key: string) => key, session: {
      command: null,
      params: null,
    } } as CustomContext

    await handler.setSessionCommand(ctx)

    expect(ctx.session.command).toBe(CommandEnum.Test)
  })

  it('should reset session correctly', async () => {
    const handler = new TestHandler()
    const ctx: any = { t: (key: string) => key, session: {
      command: CommandEnum.Test,
      params: { someParam: 'value' },
    } } as unknown as CustomContext

    await handler.resetSession(ctx)

    expect(ctx.session.command).toBeNull()
    expect(ctx.session.params).toBeNull()
  })

  describe('removeTemporaryFiles', () => {
    it('should remove temporary file if path exists in params', async () => {
      const handler = new TestHandler()
      const ctx: any = { t: (key: string) => key, session: {
        command: CommandEnum.Test,
        params: { path: '/tmp/test-file' },
      } } as unknown as CustomContext

      const rmSpy = vi.spyOn(fs, 'rm').mockResolvedValue(undefined)

      await handler.resetSession(ctx)

      expect(rmSpy).toHaveBeenCalledWith('/tmp/test-file', { force: true, recursive: true })
    })

    it('should remove temporary files if paths exist in params', async () => {
      const handler = new TestHandler()
      const ctx: any = { t: (key: string) => key, session: {
        command: CommandEnum.Test,
        params: { paths: ['/tmp/file1', '/tmp/file2'] },
      } } as unknown as CustomContext

      const rmSpy = vi.spyOn(fs, 'rm').mockResolvedValue(undefined)

      await handler.resetSession(ctx)

      expect(rmSpy).toHaveBeenCalledWith('/tmp/file1', { force: true, recursive: true })
      expect(rmSpy).toHaveBeenCalledWith('/tmp/file2', { force: true, recursive: true })
    })

    it('should ignore non-string paths in paths array', async () => {
      const handler = new TestHandler()
      const ctx: any = { t: (key: string) => key, session: {
        command: CommandEnum.Test,
        params: { paths: ['/tmp/file1', 123, null] },
      } } as unknown as CustomContext

      const rmSpy = vi.spyOn(fs, 'rm').mockResolvedValue(undefined)

      await handler.resetSession(ctx)

      expect(rmSpy).toHaveBeenCalledTimes(1)
      expect(rmSpy).toHaveBeenCalledWith('/tmp/file1', { force: true, recursive: true })
    })

    it('should catch and log error if fs.rm fails', async () => {
      const handler = new TestHandler()
      const ctx: any = { t: (key: string) => key, session: {
        command: CommandEnum.Test,
        params: { path: '/tmp/test-file' },
      } } as unknown as CustomContext

      const error = new Error('Permission denied')
      const rmSpy = vi.spyOn(fs, 'rm').mockRejectedValue(error)
      const loggerSpy = vi.spyOn((handler as any).logger, 'error')

      await handler.resetSession(ctx)

      expect(rmSpy).toHaveBeenCalled()
      expect(loggerSpy).toHaveBeenCalledWith({ error, path: '/tmp/test-file' }, 'Failed to remove temporary file/folder.')
    })
  })

  describe('validateParams', () => {
    it('should return data if validation succeeds', () => {
      const handler = new TestHandler()
      const schema = { safeParse: vi.fn().mockReturnValue({ success: true, data: { foo: 'bar' } }) } as any
      const result = (handler as any).validateParams(schema, { foo: 'bar' })
      expect(result).toEqual({ foo: 'bar' })
    })

    it('should throw SessionValidationError if validation fails', () => {
      const handler = new TestHandler()
      const schema = { safeParse: vi.fn().mockReturnValue({ success: false, error: new Error('Validation failed') }) } as any
      expect(() => (handler as any).validateParams(schema, { foo: 'bar' })).toThrow()
    })
  })

  describe('notifyLimitExceeded', () => {
    it('should reply with free_limit_reached for Free users', async () => {
      const handler = new TestHandler()
      const ctx: any = {
        t: (key: string) => key,
        user: { plan_type: PlanTypeEnum.Free },
        reply: vi.fn(),
      } as unknown as CustomContext

      await handler.notifyLimitExceeded(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('free_limit_reached')
    })

    it('should reply with pro_limit_reached for Pro users', async () => {
      const handler = new TestHandler()
      const ctx: any = {
        t: (key: string) => key,
        user: { plan_type: PlanTypeEnum.Pro },
        reply: vi.fn(),
      } as unknown as CustomContext

      await handler.notifyLimitExceeded(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('pro_limit_reached')
    })

    it('should reply with free_limit_reached if user is undefined', async () => {
      const handler = new TestHandler()
      const ctx: any = {
        t: (key: string) => key,
        reply: vi.fn(),
      } as unknown as CustomContext

      await handler.notifyLimitExceeded(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('free_limit_reached')
    })
  })

  describe('checkLimits', () => {
    it('should not throw if file size is within free limits', async () => {
      const handler = new TestHandler()
      const ctx: any = {
        t: (key: string) => key,
        user: { plan_type: PlanTypeEnum.Free },
        reply: vi.fn(),
      } as unknown as CustomContext

      await expect(
        handler.checkLimits(ctx, { fileSize: MAX_FILE_SIZE }),
      ).resolves.not.toThrow()
    })

    it('should throw LimitExceededError and reply free_limit_reached when free user exceeds file size', async () => {
      const handler = new TestHandler()
      const ctx: any = {
        t: (key: string) => key,
        user: { plan_type: PlanTypeEnum.Free },
        reply: vi.fn(),
      } as unknown as CustomContext

      await expect(
        handler.checkLimits(ctx, { fileSize: MAX_FILE_SIZE + 1 }),
      ).rejects.toThrow(LimitExceededError)
      expect(ctx.reply).toHaveBeenCalledWith('free_limit_reached')
    })

    it('should not throw if file size is within pro limits', async () => {
      const handler = new TestHandler()
      const ctx: any = {
        t: (key: string) => key,
        user: { plan_type: PlanTypeEnum.Pro },
        reply: vi.fn(),
      } as unknown as CustomContext

      await expect(
        handler.checkLimits(ctx, { fileSize: MAX_PRO_FILE_SIZE }),
      ).resolves.not.toThrow()
    })

    it('should throw LimitExceededError and reply pro_limit_reached when pro user exceeds file size', async () => {
      const handler = new TestHandler()
      const ctx: any = {
        t: (key: string) => key,
        user: { plan_type: PlanTypeEnum.Pro },
        reply: vi.fn(),
      } as unknown as CustomContext

      await expect(
        handler.checkLimits(ctx, { fileSize: MAX_PRO_FILE_SIZE + 1 }),
      ).rejects.toThrow(LimitExceededError)
      expect(ctx.reply).toHaveBeenCalledWith('pro_limit_reached')
    })

    it('should not throw if fileSize is not provided', async () => {
      const handler = new TestHandler()
      const ctx: any = {
        t: (key: string) => key,
        user: { plan_type: PlanTypeEnum.Free },
        reply: vi.fn(),
      } as unknown as CustomContext

      await expect(
        handler.checkLimits(ctx, {}),
      ).resolves.not.toThrow()
    })
  })

  it('should have usage limits enabled by default', () => {
    const handler = new TestHandler()
    expect(handler.hasUsageLimits).toBe(true)
  })

  describe(TestHandler.prototype.incrementUsage, () => {
    it('should return false if ctx.from is undefined', async () => {
      const handler = new TestHandler()
      const ctx = {
        user: { plan_type: PlanTypeEnum.Free },
      } as unknown as CustomContext
      const mockUserRepository = {
        incrementUsage: vi.fn(),
      } as unknown as UserRepository

      const result = await handler.incrementUsage(ctx, mockUserRepository)
      expect(result).toBe(false)
      expect(mockUserRepository.incrementUsage).not.toHaveBeenCalled()
    })

    it('should call incrementUsage with free limit and update ctx.user on success for free/undefined plan', async () => {
      const handler = new TestHandler()
      const ctx = {
        from: { id: 123 },
        user: null,
      } as unknown as CustomContext
      const mockUserResult = { id: 123, daily_usage_count: 1, plan_type: PlanTypeEnum.Free }
      const mockUserRepository = {
        incrementUsage: vi.fn().mockResolvedValue(mockUserResult),
      } as unknown as UserRepository

      const result = await handler.incrementUsage(ctx, mockUserRepository)
      expect(result).toBe(true)
      expect(mockUserRepository.incrementUsage).toHaveBeenCalledWith(123, DAILY_LIMITS[PlanTypeEnum.Free])
      expect(ctx.user).toBe(mockUserResult)
    })

    it('should call incrementUsage with pro limit and update ctx.user on success for pro plan', async () => {
      const handler = new TestHandler()
      const ctx = {
        from: { id: 123 },
        user: { plan_type: PlanTypeEnum.Pro },
      } as unknown as CustomContext
      const mockUserResult = { id: 123, daily_usage_count: 1, plan_type: PlanTypeEnum.Pro }
      const mockUserRepository = {
        incrementUsage: vi.fn().mockResolvedValue(mockUserResult),
      } as unknown as UserRepository

      const result = await handler.incrementUsage(ctx, mockUserRepository)
      expect(result).toBe(true)
      expect(mockUserRepository.incrementUsage).toHaveBeenCalledWith(123, DAILY_LIMITS[PlanTypeEnum.Pro])
      expect(ctx.user).toBe(mockUserResult)
    })

    it('should notify limit exceeded and return false if repository returns null', async () => {
      const handler = new TestHandler()
      const ctx = {
        t: (key: string) => key,
        from: { id: 123 },
        user: { plan_type: PlanTypeEnum.Free },
        reply: vi.fn(),
      } as unknown as CustomContext
      const mockUserRepository = {
        incrementUsage: vi.fn().mockResolvedValue(null),
      } as unknown as UserRepository

      const result = await handler.incrementUsage(ctx, mockUserRepository)
      expect(result).toBe(false)
      expect(ctx.reply).toHaveBeenCalledWith('free_limit_reached')
    })
  })

  describe(TestHandler.prototype.decrementUsage, () => {
    it('should return false if ctx.from is undefined', async () => {
      const handler = new TestHandler()
      const ctx = {} as unknown as CustomContext
      const mockUserRepository = {
        decrementUsage: vi.fn(),
      } as unknown as UserRepository

      const result = await handler.decrementUsage(ctx, mockUserRepository)
      expect(result).toBe(false)
      expect(mockUserRepository.decrementUsage).not.toHaveBeenCalled()
    })

    it('should call decrementUsage and update ctx.user on success', async () => {
      const handler = new TestHandler()
      const ctx = {
        from: { id: 123 },
        user: null,
      } as unknown as CustomContext
      const mockUserResult = { id: 123, daily_usage_count: 0, plan_type: PlanTypeEnum.Free }
      const mockUserRepository = {
        decrementUsage: vi.fn().mockResolvedValue(mockUserResult),
      } as unknown as UserRepository

      const result = await handler.decrementUsage(ctx, mockUserRepository)
      expect(result).toBe(true)
      expect(mockUserRepository.decrementUsage).toHaveBeenCalledWith(123)
      expect(ctx.user).toBe(mockUserResult)
    })

    it('should return false if repository returns null', async () => {
      const handler = new TestHandler()
      const ctx = {
        from: { id: 123 },
        user: { plan_type: PlanTypeEnum.Free },
      } as unknown as CustomContext
      const mockUserRepository = {
        decrementUsage: vi.fn().mockResolvedValue(null),
      } as unknown as UserRepository

      const result = await handler.decrementUsage(ctx, mockUserRepository)
      expect(result).toBe(false)
    })
  })

  describe(TestHandler.prototype.runWithUsage, () => {
    it('should not call action if incrementUsage returns false', async () => {
      const handler = new TestHandler()
      const ctx = {
        t: (key: string) => key,
        from: { id: 123 },
        user: { plan_type: PlanTypeEnum.Free },
        reply: vi.fn(),
      } as unknown as CustomContext
      const mockUserRepository = {
        incrementUsage: vi.fn().mockResolvedValue(null),
      } as unknown as UserRepository
      const action = vi.fn().mockResolvedValue(undefined)

      await handler.runWithUsage(ctx, mockUserRepository, action)
      expect(action).not.toHaveBeenCalled()
    })

    it('should call action if incrementUsage succeeds', async () => {
      const handler = new TestHandler()
      const ctx = {
        from: { id: 123 },
        user: { plan_type: PlanTypeEnum.Free },
      } as unknown as CustomContext
      const mockUserRepository = {
        incrementUsage: vi.fn().mockResolvedValue({ id: 123 }),
      } as unknown as UserRepository
      const action = vi.fn().mockResolvedValue(undefined)

      await handler.runWithUsage(ctx, mockUserRepository, action)
      expect(action).toHaveBeenCalled()
    })

    it('should call decrementUsage if action throws error', async () => {
      const handler = new TestHandler()
      const ctx = {
        from: { id: 123 },
        user: { plan_type: PlanTypeEnum.Free },
      } as unknown as CustomContext
      const mockUserRepository = {
        incrementUsage: vi.fn().mockResolvedValue({ id: 123 }),
        decrementUsage: vi.fn().mockResolvedValue({ id: 123 }),
      } as unknown as UserRepository
      const action = vi.fn().mockRejectedValue(new Error('Action failed'))

      await expect(handler.runWithUsage(ctx, mockUserRepository, action)).rejects.toThrow('Action failed')
      expect(mockUserRepository.decrementUsage).toHaveBeenCalledWith(123)
    })

    it('should not call decrementUsage if action throws error after markDelivered', async () => {
      const handler = new TestHandler()
      const ctx = {
        from: { id: 123 },
        user: { plan_type: PlanTypeEnum.Free },
      } as unknown as CustomContext
      const mockUserRepository = {
        incrementUsage: vi.fn().mockResolvedValue({ id: 123 }),
        decrementUsage: vi.fn().mockResolvedValue({ id: 123 }),
      } as unknown as UserRepository
      const action = vi.fn().mockImplementation(async (markDelivered) => {
        markDelivered()
        throw new Error('Action failed after delivery')
      })

      await expect(handler.runWithUsage(ctx, mockUserRepository, action)).rejects.toThrow('Action failed after delivery')
      expect(mockUserRepository.decrementUsage).not.toHaveBeenCalled()
    })
  })
})
