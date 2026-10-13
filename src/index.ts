import type { FilterQuery } from 'grammy'
import type { CustomContext } from './types/custom-context.type'
import process from 'node:process'
import { run } from '@grammyjs/runner'

import { bot } from './config/bot'
import { mongoClient } from './config/database'
import { logger } from './config/logger'
import { CommandEnum } from './enums/command.enum'
import { InvalidFileError } from './errors/invalid-file.error'
import { SessionValidationError } from './errors/session-validation.error'
import { handlers } from './handlers'
import { initReengagementJob } from './jobs/reengagement.job'
import { HelpMessage } from './messages/help.message'
import { UnknownMessage } from './messages/unknown.message'
import { i18nMiddleware } from './middlewares/i18n.middleware'
import { maintenanceMiddleware } from './middlewares/maintenance.middleware'
import { usageLimitMiddleware } from './middlewares/usage-limit.middleware'
import { repositories } from './repositories'

async function main() {
  await Promise.all(
    repositories.map(repo => repo.init()),
  )

  initReengagementJob()

  bot.use(i18nMiddleware)
  bot.use(maintenanceMiddleware)

  for (const handler of handlers) {
    bot.command(
      handler.command,
      usageLimitMiddleware(handler),
      async (ctx) => {
        try {
          await handler.onCommand(ctx)
        }
        catch (error) {
          await handleHandlerError(ctx, error)
        }
      },
    )
  }

  const handlersMap = new Map<string, (typeof handlers)[number]>(handlers.map(h => [h.command, h]))

  const events = new Set(handlers.flatMap(handler => Object.keys(handler.events) as FilterQuery[]))
  for (const event of events) {
    bot.on(event, async (ctx, next) => {
      const userId = ctx.from?.id || ctx.chat?.id
      if (!userId) {
        return
      }

      let command = ctx.session.command
      const callbackData = ctx.callbackQuery?.data
      if (event === 'callback_query' && (!command || (callbackData && handlersMap.has(callbackData)))) {
        command = CommandEnum.Help
      }

      const handler = command ? handlersMap.get(command) : undefined
      const eventHandler = handler?.events[event]

      if (!handler || !eventHandler) {
        return next()
      }

      try {
        const runWithLimit = usageLimitMiddleware(handler)
        await runWithLimit(ctx, () => eventHandler(ctx))
      }
      catch (error) {
        await handleHandlerError(ctx, error)
      }
    })
  }

  const runner = run(bot)

  await bot.api.setMyCommands(
    handlers.map(h => ({ command: h.command, description: h.description })),
  )

  bot.on('message', async (ctx) => {
    const { text, reply_markup } = new HelpMessage(handlers, ctx).build()
    await ctx.reply(
      `${new UnknownMessage(ctx).build()}\n\n${text}`,
      { reply_markup },
    )
  })

  bot.on('callback_query', ctx => ctx.answerCallbackQuery())

  const stop = async () => {
    logger.info('Shutting down gracefully...')
    try {
      await runner.stop()
      await Promise.allSettled([
        mongoClient.close(),
      ])
    }
    catch (error) {
      logger.error({ error }, 'Error during graceful shutdown.')
    }
    finally {
      process.exit(0)
    }
  }

  process
    .once('SIGINT', stop)
    .once('SIGTERM', stop)

  logger.info('Bot is running...')
}

void main()

async function handleHandlerError(ctx: CustomContext, error: unknown) {
  if (error instanceof SessionValidationError) {
    await ctx.reply(`⚠️ ${error.message}`)
    ctx.session.command = null
    ctx.session.params = null
    return
  }

  if (error instanceof InvalidFileError) {
    return
  }

  logger.error({ error }, 'Handler error occurred.')
  await ctx.reply(ctx.t('unexpected_error'))
}
