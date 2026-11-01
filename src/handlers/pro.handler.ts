import type { ConfigurationRepository } from '@/repositories/configuration.repository'
import type { PaymentRepository } from '@/repositories/payment.repository'
import type { UserRepository } from '@/repositories/user.repository'
import type { CustomContext } from '@/types/custom-context.type'
import { PaymentEntity } from '@/entities/payment.entity'
import { CommandEnum } from '@/enums/command.enum'
import { CurrencyEnum } from '@/enums/currency.enum'
import { PlanTypeEnum } from '@/enums/plan-type.enum'
import { isPlanExpired } from '@/utils/plan.util'
import { BaseHandler } from './base.handler'

export class ProHandler extends BaseHandler {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly configurationRepository: ConfigurationRepository,
  ) {
    super()
  }

  public readonly command = CommandEnum.Pro
  public readonly description = '💎 Get PRO access'
  public readonly hasUsageLimits = false
  public readonly events = {
    'pre_checkout_query': async (ctx: CustomContext) => {
      await ctx.answerPreCheckoutQuery(true)
    },
    'message:successful_payment': async (ctx: CustomContext) => {
      const userId = ctx.from?.id
      if (!userId) {
        return
      }

      const user = await this.userRepository.findByTelegramId(userId)
      if (user) {
        await Promise.all([
          this.userRepository.updateById(user._id, {
            plan_type: PlanTypeEnum.Pro,
            plan_started_at: new Date(),
          }),
          this.paymentRepository.create(new PaymentEntity({
            user_id: user._id,
            amount: ctx.message!.successful_payment!.total_amount,
            currency: ctx.message!.successful_payment!.currency as CurrencyEnum,
          })),
        ])

        await ctx.reply(ctx.t('pro_success'))
      }

      await this.resetSession(ctx)
    },
  }

  async onCommand(ctx: CustomContext) {
    const userId = ctx.from?.id
    if (!userId) {
      return
    }

    const user = await this.userRepository.findByTelegramId(userId)

    if (user?.plan_type === PlanTypeEnum.Pro) {
      const planStartedAt = user.plan_started_at
      const locale = ctx.session?.language || user.language || 'en'

      if (isPlanExpired(planStartedAt)) {
        const updated = await this.userRepository.updateById(
          user._id,
          { plan_type: PlanTypeEnum.Free, plan_started_at: null },
          { filter: { plan_started_at: planStartedAt } },
        )
        if (!updated) {
          const refreshed = await this.userRepository.findByTelegramId(userId)
          const currentStartedAt = refreshed?.plan_started_at ?? planStartedAt
          await ctx.reply(ctx.t('subscription_info').replace('{date}', currentStartedAt ? new Date(currentStartedAt).toLocaleDateString(locale) : '-'), { parse_mode: 'HTML' })
          await this.resetSession(ctx)
          return
        }
        await ctx.reply(ctx.t('pro_expired'))
        await this.resetSession(ctx)
        return
      }

      const date = planStartedAt ? new Date(planStartedAt).toLocaleDateString(locale) : '-'
      await ctx.reply(ctx.t('subscription_info').replace('{date}', date), { parse_mode: 'HTML' })
      await this.resetSession(ctx)
      return
    }

    await this.setSessionCommand(ctx)

    const { pro_price } = await this.configurationRepository.findGlobalConfig()

    await ctx.replyWithInvoice(
      'Picture Studio PRO',
      ctx.t('pro_upgrade'),
      'picture-studio-pro-subscription',
      CurrencyEnum.XTR,
      [{ label: 'PRO Subscription', amount: pro_price }],
      {
        provider_token: '',
      },
    )
  }
}
