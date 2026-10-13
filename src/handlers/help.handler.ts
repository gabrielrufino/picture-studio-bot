import type { CustomContext } from '../types/custom-context.type'
import { CommandEnum } from '../enums/command.enum'
import { HelpMessage } from '../messages/help.message'
import { BaseHandler } from './base.handler'

export class HelpHandler extends BaseHandler {
  private readonly allHandlers: BaseHandler[]

  constructor(private readonly handlers: BaseHandler[]) {
    super()
    this.allHandlers = [this, ...this.handlers]
  }

  readonly command = CommandEnum.Help
  readonly description = '❓ Show the list of available commands'
  readonly hasUsageLimits = false
  readonly events = {
    callback_query: async (ctx: CustomContext) => {
      await ctx.answerCallbackQuery()
      const command = ctx.callbackQuery?.data
      const handler = this.allHandlers.find(h => h.command === command)

      if (handler) {
        await ctx.deleteMessage().catch(error => this.logger.error({ error }, 'Failed to delete help menu message'))
        await handler.onCommand(ctx)
      }
    },
  }

  async onCommand(ctx: CustomContext) {
    const { text, reply_markup } = new HelpMessage(this.allHandlers, ctx).build()
    await ctx.reply(text, { reply_markup })
  }
}
