import type { UserEntity } from '../entities/user.entity'
import cron from 'node-cron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bot } from '../config/bot'
import { logger } from '../config/logger'
import { LanguageEnum } from '../enums/language.enum'
import { locales } from '../middlewares/i18n.middleware'
import { userRepository } from '../repositories'
import { initReengagementJob } from './reengagement.job'

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn((_cronExp, callback) => {
      ; (globalThis as any).cronCallback = callback
    }),
  },
}))

vi.mock('../config/bot', () => ({
  bot: {
    api: {
      sendMessage: vi.fn(),
    },
  },
}))

vi.mock('../config/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../repositories', () => ({
  userRepository: {
    findInactiveUsers: vi.fn(),
  },
}))

describe('reengagementJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should schedule the job', () => {
    initReengagementJob()
    expect(cron.schedule).toHaveBeenCalledWith('0 9 * * 1', expect.any(Function))
  })

  it('should send re-engagement messages to inactive users', async () => {
    const inactiveUsers: Partial<UserEntity>[] = [
      {
        _id: 'user1' as any,
        telegram_user: { id: 123 } as any,
        language: LanguageEnum.English,
      },
      {
        _id: 'user2' as any,
        telegram_user: { id: 456 } as any,
        language: LanguageEnum.Portuguese,
      },
    ]

    vi.mocked(userRepository.findInactiveUsers).mockResolvedValue({
      async* [Symbol.asyncIterator]() {
        for (const user of inactiveUsers) {
          yield user
        }
      },
    } as any)

    initReengagementJob()
    const callback = (globalThis as any).cronCallback
    await callback()

    expect(userRepository.findInactiveUsers).toHaveBeenCalledWith(30)
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(2)
    expect(bot.api.sendMessage).toHaveBeenCalledWith(123, locales.en.reengagement_message, { parse_mode: 'HTML' })
    expect(bot.api.sendMessage).toHaveBeenCalledWith(456, locales.pt.reengagement_message, { parse_mode: 'HTML' })
  })

  it('should log an error and continue if sending a message fails', async () => {
    const error = new Error('Telegram API Error')
    vi.mocked(bot.api.sendMessage).mockRejectedValueOnce(error).mockResolvedValueOnce({} as any)

    const inactiveUsers: Partial<UserEntity>[] = [
      {
        _id: 'user1' as any,
        telegram_user: { id: 123 } as any,
        language: LanguageEnum.English,
      },
      {
        _id: 'user2' as any,
        telegram_user: { id: 456 } as any,
        language: LanguageEnum.Portuguese,
      },
    ]

    vi.mocked(userRepository.findInactiveUsers).mockResolvedValue({
      async* [Symbol.asyncIterator]() {
        for (const user of inactiveUsers) {
          yield user
        }
      },
    } as any)

    initReengagementJob()
    const callback = (globalThis as any).cronCallback
    await callback()

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(2)
    expect(bot.api.sendMessage).toHaveBeenNthCalledWith(1, 123, locales.en.reengagement_message, { parse_mode: 'HTML' })
    expect(bot.api.sendMessage).toHaveBeenNthCalledWith(2, 456, locales.pt.reengagement_message, { parse_mode: 'HTML' })
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      { error, userId: 123 },
      'Failed to send re-engagement message',
    )
  })
})
