import type { ISession } from '@grammyjs/storage-mongodb'
import type { SessionData } from '../interfaces/session-data.interface'
import type { CustomContext } from '../types/custom-context.type'
import process from 'node:process'
import { hydrateFiles } from '@grammyjs/files'
import { limit } from '@grammyjs/ratelimiter'
import { MongoDBAdapter } from '@grammyjs/storage-mongodb'
import { Bot, session } from 'grammy'
import { authMiddleware } from '../middlewares/auth.middleware'
import { eventRecorderMiddleware } from '../middlewares/event-recorder.middleware'
import { loggerMiddleware } from '../middlewares/logger.middleware'
import { messageRecorderMiddleware } from '../middlewares/message-recorder.middleware'
import { database } from './database'
import { logger } from './logger'

const bot = new Bot<CustomContext>(process.env.BOT_TOKEN!)

bot.use(
  limit({
    timeFrame: 2000,
    limit: 3,
    onLimitExceeded: async (ctx) => {
      await ctx.reply('Too many requests. Please try again in a few seconds.')
    },
    keyGenerator: ctx => ctx.from?.id?.toString(),
  }),
)

bot.use(
  session({
    initial: (): SessionData => ({
      command: null,
      params: null,
    }),
    storage: new MongoDBAdapter({ collection: database.collection<ISession>('sessions') as any }),
    getSessionKey: (ctx) => {
      const id = ctx.from?.id || ctx.chat?.id
      if (!id) {
        logger.warn({ update_id: ctx.update?.update_id }, 'Session key could not be determined for update')
        return undefined
      }
      return id.toString()
    },
  }),
)

bot.use(loggerMiddleware)

bot.use(messageRecorderMiddleware)
bot.use(eventRecorderMiddleware)
bot.use(authMiddleware)

bot
  .api
  .config
  .use(hydrateFiles(bot.token))

bot.catch((err) => {
  logger.error(err)
})

export { bot }
