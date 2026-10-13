import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LanguageEnum } from '../enums/language.enum'
import { userRepository } from '../repositories'
import { i18nMiddleware, locales } from './i18n.middleware'

vi.mock('../repositories', () => ({
  userRepository: {
    findByTelegramId: vi.fn(),
  },
}))

describe(i18nMiddleware.name, () => {
  let next: any
  let ctx: any

  beforeEach(() => {
    next = vi.fn()
    ctx = {
      from: { id: 12345, language_code: undefined },
      session: { language: undefined },
      t: undefined,
      user: undefined,
    }
    vi.clearAllMocks()
  })

  it('should use language from session if present', async () => {
    ctx.session.language = LanguageEnum.Spanish

    await i18nMiddleware(ctx, next)

    expect(userRepository.findByTelegramId).not.toHaveBeenCalled()
    expect(ctx.session.language).toBe(LanguageEnum.Spanish)
    expect(ctx.t('operation_help')).toBe(locales.es.operation_help)
    expect(next).toHaveBeenCalled()
  })

  it('should use language from user database if session is empty', async () => {
    vi.mocked(userRepository.findByTelegramId).mockResolvedValueOnce({
      language: LanguageEnum.Portuguese,
    } as any)

    await i18nMiddleware(ctx, next)

    expect(userRepository.findByTelegramId).toHaveBeenCalledWith(12345)
    expect(ctx.session.language).toBe(LanguageEnum.Portuguese)
    expect(ctx.t('operation_help')).toBe(locales.pt.operation_help)
    expect(next).toHaveBeenCalled()
  })

  it('should not query database if user is available on context', async () => {
    ctx.user = {
      language: LanguageEnum.Portuguese,
    }

    await i18nMiddleware(ctx, next)

    expect(userRepository.findByTelegramId).not.toHaveBeenCalled()
    expect(ctx.session.language).toBe(LanguageEnum.Portuguese)
    expect(ctx.t('operation_help')).toBe(locales.pt.operation_help)
    expect(next).toHaveBeenCalled()
  })

  it('should use language from context if user has no language in database and language code is supported', async () => {
    vi.mocked(userRepository.findByTelegramId).mockResolvedValueOnce({
      language: undefined,
    } as any)
    ctx.from.language_code = 'es'

    await i18nMiddleware(ctx, next)

    expect(ctx.session.language).toBe(LanguageEnum.Spanish)
    expect(ctx.t('operation_help')).toBe(locales.es.operation_help)
    expect(next).toHaveBeenCalled()
  })

  it('should fallback to english if language from context is not supported', async () => {
    vi.mocked(userRepository.findByTelegramId).mockResolvedValueOnce({
      language: undefined,
    } as any)
    ctx.from.language_code = 'fr' // Not supported

    await i18nMiddleware(ctx, next)

    expect(ctx.session.language).toBe(LanguageEnum.English)
    expect(ctx.t('operation_help')).toBe(locales.en.operation_help)
    expect(next).toHaveBeenCalled()
  })

  it('should fallback to english if database user is not found and no context language code', async () => {
    vi.mocked(userRepository.findByTelegramId).mockResolvedValueOnce(null)

    await i18nMiddleware(ctx, next)

    expect(ctx.session.language).toBe(LanguageEnum.English)
    expect(ctx.t('operation_help')).toBe(locales.en.operation_help)
    expect(next).toHaveBeenCalled()
  })

  it('should fallback to english translations if from is missing', async () => {
    ctx.from = undefined

    await i18nMiddleware(ctx, next)

    expect(ctx.session.language).toBeUndefined()
    expect(ctx.t('operation_help')).toBe(locales.en.operation_help)
    expect(next).toHaveBeenCalled()
  })

  describe('ctx.t translation function', () => {
    it('should translate known keys using the selected language', async () => {
      ctx.session.language = LanguageEnum.English
      await i18nMiddleware(ctx, next)

      expect(ctx.t('operation_help')).toBe(locales.en.operation_help)
    })

    it('should return the key if translation is not found', async () => {
      ctx.session.language = LanguageEnum.English
      await i18nMiddleware(ctx, next)

      expect(ctx.t('unknown_translation_key')).toBe('unknown_translation_key')
    })

    it('should fallback to english translations if language is somehow unsupported string', async () => {
      ctx.session.language = 'unsupported' as any
      await i18nMiddleware(ctx, next)

      expect(ctx.t('operation_help')).toBe(locales.en.operation_help)
    })
  })
})
