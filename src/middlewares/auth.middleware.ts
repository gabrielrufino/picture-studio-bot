import type { NextFunction } from 'grammy'
import type { CustomContext } from '../types/custom-context.type'
import { userRepository } from '../repositories'

export async function authMiddleware(ctx: CustomContext, next: NextFunction) {
  if (!ctx.from?.id) {
    await ctx.reply('Unable to identify you. Access denied.')
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
