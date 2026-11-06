import type { NextFunction } from 'grammy'
import type { CustomContext } from '@/types/custom-context.type'
import { logger } from '@/config/logger'
import { MessageEntity } from '@/entities/message.entity'
import { messageRepository } from '@/repositories'

export function messageRecorderMiddleware(ctx: CustomContext, next: NextFunction) {
  if (ctx.message) {
    const message = new MessageEntity({
      text: ctx.message.text || '',
      telegram_user: ctx.from!,
    })

    messageRepository.create(message).catch((error: unknown) => {
      logger.error({ error }, 'Failed to record message')
    })
  }

  return next()
}
