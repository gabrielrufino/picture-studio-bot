import type { NextFunction } from 'grammy'
import type { CustomContext } from '../types/custom-context.type'
import { logger } from '../config/logger'

export function loggerMiddleware(ctx: CustomContext, next: NextFunction) {
  const { from } = ctx
  logger.info({
    from,
  })

  return next()
}
