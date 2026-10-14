import type { FilterQuery } from 'grammy'
import type { z } from 'zod'
import type { CommandEnum } from '../enums/command.enum'
import type { UserRepository } from '../repositories/user.repository'
import type { CustomContext } from '../types/custom-context.type'
import fs from 'node:fs/promises'
import { DAILY_LIMITS, MAX_FILE_SIZE, MAX_PRO_FILE_SIZE } from '../config/constants'
import { logger } from '../config/logger'
import { PlanTypeEnum } from '../enums/plan-type.enum'
import { LimitExceededError } from '../errors/limit-exceeded.error'
import { SessionValidationError } from '../errors/session-validation.error'

export abstract class BaseHandler {
  public abstract readonly command: CommandEnum
  public abstract readonly description: string
  public abstract readonly events: Partial<Record<FilterQuery, (ctx: CustomContext) => Promise<void>>>
  public abstract onCommand(ctx: CustomContext): Promise<void>
  public readonly hasUsageLimits: boolean = true

  protected readonly logger = logger

  protected validateParams<T>(schema: z.ZodSchema<T>, params: unknown): T {
    const result = schema.safeParse(params)

    if (!result.success) {
      this.logger.error({ error: result.error }, 'Session validation failed.')
      throw new SessionValidationError()
    }

    return result.data
  }

  protected async setSessionCommand(ctx: CustomContext) {
    await this.removeTemporaryFiles(ctx)
    ctx.session.command = this.command
  }

  protected async resetSession(ctx: CustomContext) {
    await this.removeTemporaryFiles(ctx)
    ctx.session.command = null
    ctx.session.params = null
  }

  protected async notifyLimitExceeded(ctx: CustomContext): Promise<void> {
    const isPro = ctx.user?.plan_type === PlanTypeEnum.Pro
    await ctx.reply(ctx.t(isPro ? 'pro_limit_reached' : 'free_limit_reached'))
  }

  protected async checkLimits(
    ctx: CustomContext,
    options: { fileSize?: number },
  ): Promise<void> {
    const isPro = ctx.user?.plan_type === PlanTypeEnum.Pro

    if (options.fileSize !== undefined) {
      if (!isPro && options.fileSize > MAX_FILE_SIZE) {
        await this.notifyLimitExceeded(ctx)
        throw new LimitExceededError()
      }
      if (isPro && options.fileSize > MAX_PRO_FILE_SIZE) {
        await this.notifyLimitExceeded(ctx)
        throw new LimitExceededError()
      }
    }
  }

  protected async incrementUsage(ctx: CustomContext, userRepository: UserRepository): Promise<boolean> {
    const isPro = ctx.user?.plan_type === PlanTypeEnum.Pro
    const limit = isPro ? DAILY_LIMITS[PlanTypeEnum.Pro] : DAILY_LIMITS[PlanTypeEnum.Free]

    const userId = ctx.from?.id
    if (!userId) {
      return false
    }

    const result = await userRepository.incrementUsage(userId, limit)
    if (!result) {
      await this.notifyLimitExceeded(ctx)
      return false
    }

    ctx.user = result
    return true
  }

  protected async decrementUsage(ctx: CustomContext, userRepository: UserRepository): Promise<boolean> {
    const userId = ctx.from?.id
    if (!userId) {
      return false
    }

    const result = await userRepository.decrementUsage(userId)
    if (!result) {
      return false
    }

    ctx.user = result
    return true
  }

  protected async runWithUsage(
    ctx: CustomContext,
    userRepository: UserRepository,
    action: (markDelivered: () => void) => Promise<void>,
  ): Promise<void> {
    let usageReserved = false
    let delivered = false
    try {
      usageReserved = await this.incrementUsage(ctx, userRepository)
      if (!usageReserved) {
        return
      }
      await action(() => {
        delivered = true
      })
    }
    catch (error) {
      if (usageReserved && !delivered) {
        await this.decrementUsage(ctx, userRepository)
      }
      throw error
    }
  }

  private async removeTemporaryFiles(ctx: CustomContext) {
    const params = ctx.session.params

    if (!params) {
      return
    }

    const paths: string[] = []

    if ('path' in params && typeof params.path === 'string') {
      paths.push(params.path)
    }

    if ('paths' in params && Array.isArray(params.paths)) {
      paths.push(...params.paths.filter((p: unknown): p is string => typeof p === 'string'))
    }

    await Promise.all(
      paths.map((path: string) =>
        fs.rm(path, { force: true, recursive: true }).catch((error: unknown) =>
          this.logger.error({ error, path }, 'Failed to remove temporary file/folder.'),
        ),
      ),
    )
  }
}
