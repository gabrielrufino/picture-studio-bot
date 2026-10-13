import type { UserRepository } from '../repositories/user.repository'
import type { CustomContext } from '../types/custom-context.type'
import { InlineKeyboard } from 'grammy'
import { CommandEnum } from '../enums/command.enum'
import { LanguageEnum } from '../enums/language.enum'
import { locales } from '../middlewares/i18n.middleware'
import { BaseHandler } from './base.handler'

const ALLOWED_LANGUAGES = new Set<string>(Object.values(LanguageEnum))

export class LanguageHandler extends BaseHandler {
  constructor(private readonly userRepository: UserRepository) {
    super()
  }

  public readonly command = CommandEnum.Language
  public readonly description = '🌐 Change your language'
  public readonly hasUsageLimits = false
  public readonly events = {
    callback_query: async (ctx: CustomContext) => {
      const data = ctx.callbackQuery?.data
      if (!data || !ALLOWED_LANGUAGES.has(data)) {
        return
      }

      const user = ctx.user
      if (user) {
        user.language = data as LanguageEnum
        await this.userRepository.updateById(user._id, user)
      }

      ctx.session.language = data as LanguageEnum

      const translations = locales[data] || locales[LanguageEnum.English]
      const message = translations.language_changed || 'Language changed!'

      await ctx.answerCallbackQuery(message)
      await ctx.editMessageText(message)
      await this.resetSession(ctx)
    },
  }

  async onCommand(ctx: CustomContext) {
    await this.setSessionCommand(ctx)
    const keyboard = new InlineKeyboard()
      .text('English', LanguageEnum.English)
      .row()
      .text('Português', LanguageEnum.Portuguese)
      .row()
      .text('Español', LanguageEnum.Spanish)

    await ctx.reply(ctx.t('language_choose'), {
      reply_markup: keyboard,
    })
  }
}
