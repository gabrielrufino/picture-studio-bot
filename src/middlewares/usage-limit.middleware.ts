import type { NextFunction } from 'grammy'
import type { BaseHandler } from '../handlers/base.handler'
import type { CustomContext } from '../types/custom-context.type'
import { DAILY_LIMITS } from '../config/constants'
import { UserEntity } from '../entities/user.entity'
import { LanguageEnum } from '../enums/language.enum'
import { PlanTypeEnum } from '../enums/plan-type.enum'
import { userRepository } from '../repositories'

export function usageLimitMiddleware(handler: BaseHandler) {
  return async (ctx: CustomContext, next: NextFunction) => {
    if (!handler.hasUsageLimits) {
      return next()
    }

    const userId = ctx.from?.id
    if (!userId) {
      return next()
    }

    let user = ctx.user
    if (user === undefined) {
      user = await userRepository.findByTelegramId(userId)
    }

    if (!user) {
      user = await userRepository.create(new UserEntity({
        telegram_user: ctx.from!,
        language: ctx.session?.language || LanguageEnum.English,
      }))
    }
    else if (user.plan_type === PlanTypeEnum.Pro && user.plan_started_at) {
      const oneMonthAgo = new Date()
      oneMonthAgo.setDate(oneMonthAgo.getDate() - 30) // 30 days expiration

      if (user.plan_started_at < oneMonthAgo) {
        await userRepository.updateById(user._id, { plan_type: PlanTypeEnum.Free, plan_started_at: null })
        user.plan_type = PlanTypeEnum.Free
      }
    }

    ctx.user = user

    const limit = DAILY_LIMITS[user.plan_type || PlanTypeEnum.Free]

    const today = new Date().toISOString().split('T')[0]
    const isWithinLimit = !user.is_blocked && (user.last_usage_date !== today || (user.daily_usage_count || 0) < limit)

    if (!isWithinLimit) {
      if (user.plan_type === PlanTypeEnum.Pro) {
        await ctx.reply(ctx.t('pro_limit_reached'))
      }
      else {
        await ctx.reply(ctx.t('free_limit_reached'))
      }
      return
    }

    return next()
  }
}
