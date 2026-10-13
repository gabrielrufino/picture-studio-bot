import type { FeedbackRepository } from '../repositories/feedback.repository'
import type { CustomContext } from '../types/custom-context.type'
import { FeedbackEntity } from '../entities/feedback.entity'
import { CommandEnum } from '../enums/command.enum'
import { BaseHandler } from './base.handler'

export class FeedbackHandler extends BaseHandler {
  constructor(
    private readonly feedbackRepository: FeedbackRepository,
  ) {
    super()
  }

  public readonly command = CommandEnum.Feedback
  public readonly description = '💬 Send us your feedback'
  public readonly hasUsageLimits = false
  public readonly events = {
    'msg:text': async (ctx: CustomContext) => {
      const feedback = ctx.message?.text

      await this.feedbackRepository.create(new FeedbackEntity({
        telegram_user: ctx.from!,
        text: feedback!,
        created_at: new Date(),
      }))

      await ctx.reply(ctx.t('feedback_success'))
      await this.resetSession(ctx)
    },
  }

  public async onCommand(ctx: CustomContext): Promise<void> {
    await this.setSessionCommand(ctx)

    await ctx.reply(ctx.t('feedback_send_message'))
  }
}
