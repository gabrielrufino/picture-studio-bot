import type { UserRepository } from '../repositories/user.repository'
import type { CustomContext } from '../types/custom-context.type'
import { InlineKeyboard } from 'grammy'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandEnum } from '../enums/command.enum'
import { LanguageEnum } from '../enums/language.enum'
import { LanguageHandler } from './language.handler'

vi.mock('../config/database', () => ({
  database: {
    collection: vi.fn(),
  },
  mongoClient: {},
}))
vi.mock('../repositories')

describe(LanguageHandler.name, () => {
  let handler: LanguageHandler
  let userRepository: UserRepository

  beforeEach(() => {
    userRepository = {
      create: vi.fn(),
      findByTelegramId: vi.fn().mockResolvedValue(null),
      updateById: vi.fn(),
    } as unknown as UserRepository

    handler = new LanguageHandler(userRepository)
  })

  it('should be defined', () => {
    expect(handler).toBeDefined()
  })

  it('should have the correct command', () => {
    expect(handler.command).toBe(CommandEnum.Language)
  })

  it('should have the correct description', () => {
    expect(handler.description).toBe('🌐 Change your language')
  })

  it('should have correct hasUsageLimits value', () => {
    expect(handler.hasUsageLimits).toBe(false)
  })

  describe(LanguageHandler.prototype.onCommand.name, () => {
    it('should set session command and reply with language options', async () => {
      const ctx = {
        t: (key: string) => key,
        session: {
          command: null,
          params: null,
        },
        reply: vi.fn(),
      } as unknown as CustomContext

      await handler.onCommand(ctx)

      expect(ctx.session.command).toBe(CommandEnum.Language)
      expect(ctx.reply).toHaveBeenCalledTimes(1)

      const expectedKeyboard = new InlineKeyboard()
        .text('English', LanguageEnum.English)
        .row()
        .text('Português', LanguageEnum.Portuguese)
        .row()
        .text('Español', LanguageEnum.Spanish)

      expect(ctx.reply).toHaveBeenCalledWith('language_choose', {
        reply_markup: expectedKeyboard,
      })
    })
  })

  describe('events.callback_query', () => {
    it('should do nothing if data is missing', async () => {
      const ctx = {
        callbackQuery: {},
      } as unknown as CustomContext

      await handler.events.callback_query(ctx)
    })

    it('should do nothing if data is not a valid LanguageEnum', async () => {
      const ctx = {
        callbackQuery: { data: 'invalid' },
      } as unknown as CustomContext

      await handler.events.callback_query(ctx)
    })

    it('should update user language if user exists', async () => {
      const mockUser = {
        _id: 'user_123',
        language: LanguageEnum.English,
      }
      vi.mocked(userRepository.findByTelegramId).mockResolvedValue(mockUser as any)

      const ctx = {
        callbackQuery: { data: LanguageEnum.Spanish },
        from: { id: 12345 },
        user: mockUser,
        session: { language: LanguageEnum.English, command: CommandEnum.Language, params: {} },
        answerCallbackQuery: vi.fn(),
        editMessageText: vi.fn(),
      } as unknown as CustomContext

      await handler.events.callback_query(ctx)

      expect(mockUser.language).toBe(LanguageEnum.Spanish)
      expect(userRepository.updateById).toHaveBeenCalledWith('user_123', mockUser)
    })

    it('should set session language, send responses and reset session', async () => {
      vi.mocked(userRepository.findByTelegramId).mockResolvedValue(null)

      const ctx = {
        callbackQuery: { data: LanguageEnum.Portuguese },
        from: { id: 12345 },
        user: null,
        session: { language: LanguageEnum.English, command: CommandEnum.Language, params: { foo: 'bar' } },
        answerCallbackQuery: vi.fn(),
        editMessageText: vi.fn(),
      } as unknown as CustomContext

      await handler.events.callback_query(ctx)

      expect(ctx.session.language).toBe(LanguageEnum.Portuguese)

      expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1)
      expect(ctx.editMessageText).toHaveBeenCalledTimes(1)
      expect(ctx.session.command).toBeNull()
      expect(ctx.session.params).toBeNull()
    })
  })
})
