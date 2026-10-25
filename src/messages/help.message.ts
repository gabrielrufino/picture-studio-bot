import type { BaseHandler } from '@/handlers/base.handler'
import type { CustomContext } from '@/types/custom-context.type'
import { InlineKeyboard } from 'grammy'
import { CommandEnum } from '@/enums/command.enum'
import { PlanTypeEnum } from '@/enums/plan-type.enum'

export class HelpMessage {
  private static readonly OPERATIONS = new Set<string>([
    CommandEnum.Compress,
    CommandEnum.Convert,
    CommandEnum.Crop,
    CommandEnum.Info,
    CommandEnum.Resize,
    CommandEnum.Rotate,
    CommandEnum.Language,
  ])

  private static readonly INFORMATION = new Set<string>([
    CommandEnum.Pro,
    CommandEnum.Feedback,
    CommandEnum.Version,
    CommandEnum.Help,
  ])

  private static cache = new WeakMap<BaseHandler[], Record<string, { text: string, reply_markup: InlineKeyboard }>>()

  constructor(
    private readonly handlers: BaseHandler[],
    private readonly ctx: CustomContext,
  ) {}

  public build() {
    let handlersCache = HelpMessage.cache.get(this.handlers)
    if (!handlersCache) {
      handlersCache = {}
      HelpMessage.cache.set(this.handlers, handlersCache)
    }

    const isPro = this.ctx.user?.plan_type === PlanTypeEnum.Pro
    const language = this.ctx.session?.language || 'en'
    const cacheKey = `${language}_${isPro ? 'pro' : 'free'}`
    if (handlersCache[cacheKey]) {
      return handlersCache[cacheKey]
    }

    const operationHandlers = this.handlers.filter(h => HelpMessage.OPERATIONS.has(h.command))
    const informationHandlers = this.handlers.filter(h => HelpMessage.INFORMATION.has(h.command))

    const keyboard = [
      ...operationHandlers,
      ...informationHandlers,
    ].reduce(
      (kb, h) => {
        const commandKey = h.command === CommandEnum.Pro && isPro
          ? 'operation_subscription'
          : `operation_${h.command}`
        return kb.text(this.ctx.t(commandKey), h.command).row()
      },
      new InlineKeyboard(),
    )

    const result = {
      text: this.ctx.t('help_select_operation'),
      reply_markup: keyboard,
    }

    handlersCache[cacheKey] = result

    return result
  }
}
