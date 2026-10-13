import { setTimeout } from 'node:timers/promises'
import cron from 'node-cron'
import { bot } from '../config/bot'
import { logger } from '../config/logger'
import { locales } from '../middlewares/i18n.middleware'
import { userRepository } from '../repositories'

export function initReengagementJob() {
  // Weekly on Monday at 9 AM
  cron.schedule('0 9 * * 1', async () => {
    logger.info('Running re-engagement job...')
    try {
      const inactiveUsersCursor = await userRepository.findInactiveUsers(30)

      for await (const user of inactiveUsersCursor) {
        if (!user.telegram_user?.id) {
          continue
        }

        const translations = locales[user.language] || locales.en
        const message = translations.reengagement_message

        try {
          await bot.api.sendMessage(user.telegram_user.id, message, { parse_mode: 'HTML' })
        }
        catch (error: any) {
          if (error?.error_code === 403 || error?.message?.includes('bot was blocked by the user')) {
            logger.info({ userId: user.telegram_user.id }, 'User blocked the bot, marking as inactive for re-engagement')
            try {
              await userRepository.updateById(user._id, { is_bot_blocked: true })
            }
            catch (dbError) {
              logger.error({ dbError, userId: user.telegram_user.id }, 'Failed to update is_bot_blocked status')
            }
          }
          else {
            logger.error({ error, userId: user.telegram_user.id }, 'Failed to send re-engagement message')
          }
        }
        finally {
          // Sleep for 50ms to respect rate limits (max 30 messages per second)
          await setTimeout(50)
        }
      }
      logger.info('Re-engagement job finished')
    }
    catch (error) {
      logger.error({ error }, 'Error in re-engagement job')
    }
  })
}
