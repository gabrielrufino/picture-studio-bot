import type { NextFunction } from 'grammy'
import type { CustomContext } from '@/types/custom-context.type'
import process from 'node:process'
import { userRepository } from '@/repositories'

function getAllowedTelegramIds() {
  const value = process.env.ALLOWED_TELEGRAM_IDS
  if (!value) {
    return null
  }

  return new Set(value.split(',').map(id => id.trim()).filter(Boolean))
}

export async function authMiddleware(ctx: CustomContext, next: NextFunction) {
  if (!ctx.from?.id) {
    await ctx.reply(ctx.t('access_denied'))
    return
  }

  const allowedIds = getAllowedTelegramIds()
  if (allowedIds && !allowedIds.has(String(ctx.from.id))) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery()
    }
    return
  }

  const user = await userRepository.findByTelegramId(ctx.from.id)
  ctx.user = user

  if (user?.is_blocked) {
    await ctx.reply('You are blocked from using this bot.')
    return
  }

  return next()
}
