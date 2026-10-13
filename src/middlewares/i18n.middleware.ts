import type { NextFunction } from 'grammy'
import type { CustomContext } from '../types/custom-context.type'
import { LanguageEnum } from '../enums/language.enum'
import en from '../locales/en.json'
import es from '../locales/es.json'
import pt from '../locales/pt.json'
import { userRepository } from '../repositories'

export const locales: Record<string, Record<string, string>> = {
  en,
  pt,
  es,
}

const ALLOWED_LANGUAGES = new Set(Object.values(LanguageEnum))

export async function i18nMiddleware(ctx: CustomContext, next: NextFunction) {
  const userId = ctx.from?.id
  let language = ctx.session.language

  if (!language && userId) {
    let user = ctx.user
    if (user === undefined) {
      user = await userRepository.findByTelegramId(userId)
      ctx.user = user
    }

    if (user?.language) {
      language = user.language
    }
    else if (ctx.from?.language_code && ALLOWED_LANGUAGES.has(ctx.from.language_code as any)) {
      language = ctx.from.language_code as any
    }
    else {
      language = LanguageEnum.English
    }

    ctx.session.language = language
  }

  if (!language) {
    language = LanguageEnum.English
  }

  const translations = locales[language as string] || locales.en

  ctx.t = (key: string) => translations[key] || key

  return next()
}
