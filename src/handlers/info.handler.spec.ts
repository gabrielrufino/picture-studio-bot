import type { UserRepository } from '@/repositories/user.repository'
import type { CustomContext } from '@/types/custom-context.type'
import fs from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandEnum } from '@/enums/command.enum'
import { InvalidFileError } from '@/errors/invalid-file.error'
import { LimitExceededError } from '@/errors/limit-exceeded.error'
import en from '@/locales/en.json'
import es from '@/locales/es.json'
import pt from '@/locales/pt.json'
import { InfoHandler } from './info.handler'

const INFO_RESULT_TEMPLATE = 'ℹ️ <b>Image Info</b>\n\n📐 Dimensions: {width}x{height}\n🎨 Format: {format}\n📦 File size: {size}'

vi.mock('node:fs/promises', () => ({
  default: {
    stat: vi.fn().mockResolvedValue({ size: 102400 }),
    rm: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('node:os', () => ({
  default: {
    tmpdir: vi.fn().mockReturnValue('/tmp'),
  },
}))

vi.mock('sharp', () => ({
  default: vi.fn().mockReturnValue({
    metadata: vi.fn().mockResolvedValue({ width: 1920, height: 1080, format: 'jpeg' }),
  }),
}))

vi.mock('grammy', async () => {
  const actual = await vi.importActual<typeof import('grammy')>('grammy')
  return {
    ...actual,
    InputFile: class {
      constructor(public path: string, public name: string) {}
    },
  }
})

vi.mock('@/utils/format.util', () => ({
  formatString: (template: string, replacements: Record<string, string>) =>
    Object.entries(replacements).reduce((acc, [key, value]) => acc.replace(`{${key}}`, value), template),
}))

describe(InfoHandler.name, () => {
  let userRepository: UserRepository
  let handler: InfoHandler
  let ctx: CustomContext

  beforeEach(() => {
    userRepository = {
      incrementUsage: vi.fn().mockResolvedValue({}),
      decrementUsage: vi.fn().mockResolvedValue({}),
    } as unknown as UserRepository

    handler = new InfoHandler(userRepository)
    // @ts-expect-error logger is protected
    handler.logger = { error: vi.fn() } as any

    ctx = {
      session: { command: CommandEnum.Info, params: null },
      t: vi.fn(key => key === 'info_result' ? INFO_RESULT_TEMPLATE : key),
      user: { id: 1 },
      from: { id: 1 },
      reply: vi.fn().mockResolvedValue(undefined),
      replyWithPhoto: vi.fn().mockResolvedValue(undefined),
      api: {
        getFile: vi.fn().mockResolvedValue({
          file_id: 'photo-id',
          file_size: 100,
          download: vi.fn().mockResolvedValue('/tmp/input.jpg'),
        }),
      },
      message: { photo: [{ file_id: 'photo-id', file_size: 100 }] },
    } as unknown as CustomContext

    vi.clearAllMocks()
  })

  describe(InfoHandler.prototype.onCommand.name, () => {
    it('should set session command and prompt for file', async () => {
      await handler.onCommand(ctx)

      expect((handler as any).logger.error).not.toHaveBeenCalled()
      expect(ctx.session.command).toBe(CommandEnum.Info)
      expect(ctx.reply).toHaveBeenCalledWith('info_send_file')
    })
  })

  describe('locales', () => {
    it.each([
      { locale: 'en', template: en.info_result },
      { locale: 'es', template: es.info_result },
      { locale: 'pt', template: pt.info_result },
    ])('should keep required placeholders in $locale info_result', ({ template }) => {
      expect(template).toContain('{width}')
      expect(template).toContain('{height}')
      expect(template).toContain('{format}')
      expect(template).toContain('{size}')
    })
  })

  describe('events', () => {
    describe('msg:photo', () => {
      it('should successfully read image info and send result', async () => {
        await handler.events['msg:photo']!(ctx)

        const calls = (ctx.reply as any).mock.calls
        expect(calls[0][0]).toBe('info_processing')
        // Second call is formatString'd result containing width, height, format, size
        expect(calls[1][0]).toBe(
          'ℹ️ <b>Image Info</b>\n\n📐 Dimensions: 1920x1080\n🎨 Format: JPEG\n📦 File size: 100.0 KB',
        )
        expect(userRepository.incrementUsage).toHaveBeenCalledWith(1, 3)
        expect(ctx.session.command).toBeNull()
        expect(ctx.session.params).toBeNull()
      })

      it('should throw UserNotFoundError if no user', async () => {
        ctx.user = null as any

        await handler.events['msg:photo']!(ctx)

        expect(ctx.reply).toHaveBeenCalledWith('info_error')
        expect((handler as any).logger.error).toHaveBeenCalled()
      })

      it('should ignore LimitExceededError gracefully', async () => {
        vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new LimitExceededError())

        await handler.events['msg:photo']!(ctx)

        expect(ctx.reply).not.toHaveBeenCalledWith('info_error')
      })

      it('should check file size against limits after download', async () => {
        const checkLimitsSpy = vi.spyOn(handler as any, 'checkLimits').mockResolvedValue(undefined)

        await handler.events['msg:photo']!(ctx)

        // First call is before download with photo.file_size
        expect(checkLimitsSpy).toHaveBeenCalledWith(ctx, { fileSize: 100 })
        // Second call is after download with fs.stat size
        expect(checkLimitsSpy).toHaveBeenCalledWith(ctx, { fileSize: 102400 })
      })

      it('should reply invalid file message on InvalidFileError in validateImageFile', async () => {
        vi.spyOn(handler as any, 'validateImageFile').mockRejectedValueOnce(new InvalidFileError())

        await handler.events['msg:photo']!(ctx)

        expect(ctx.reply).toHaveBeenCalledWith('info_invalid_file')
        expect(ctx.reply).not.toHaveBeenCalledWith('info_error')
        expect(userRepository.incrementUsage).toHaveBeenCalled()
        expect(userRepository.decrementUsage).toHaveBeenCalled()
      })

      it('should reply error on unexpected error', async () => {
        vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new Error('Unexpected'))

        await handler.events['msg:photo']!(ctx)

        expect(ctx.reply).toHaveBeenCalledWith('info_error')
        expect((handler as any).logger.error).toHaveBeenCalled()
      })

      it('should handle fs.rm errors in finally block', async () => {
        vi.mocked(fs.rm).mockRejectedValueOnce(new Error('rm error'))

        await handler.events['msg:photo']!(ctx)

        expect((handler as any).logger.error).toHaveBeenCalled()
      })
    })

    describe('msg:document', () => {
      it('should process image documents and send info result', async () => {
        const docCtx = {
          session: { command: CommandEnum.Info, params: null },
          t: vi.fn(key => key === 'info_result' ? INFO_RESULT_TEMPLATE : key),
          user: { id: 1 },
          from: { id: 1 },
          reply: vi.fn().mockResolvedValue(undefined),
          replyWithPhoto: vi.fn().mockResolvedValue(undefined),
          api: {
            getFile: vi.fn().mockResolvedValue({
              file_id: 'doc-id',
              file_size: 200,
              download: vi.fn().mockResolvedValue('/tmp/input.jpg'),
            }),
          },
          message: { document: { file_id: 'doc-id', file_size: 200, mime_type: 'image/jpeg' } },
        } as unknown as CustomContext

        await handler.events['msg:document']!(docCtx)

        const calls = (docCtx.reply as any).mock.calls
        expect(calls[0][0]).toBe('info_processing')
        expect(calls[1][0]).toBe(
          'ℹ️ <b>Image Info</b>\n\n📐 Dimensions: 1920x1080\n🎨 Format: JPEG\n📦 File size: 100.0 KB',
        )
        expect(userRepository.incrementUsage).toHaveBeenCalledWith(1, 3)
      })

      it('should not reply with info result when downloaded document exceeds limits', async () => {
        const checkLimitsSpy = vi.spyOn(handler as any, 'checkLimits')
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new LimitExceededError())

        const docCtx = {
          session: { command: CommandEnum.Info, params: null },
          t: vi.fn(key => key),
          user: { id: 1 },
          from: { id: 1 },
          reply: vi.fn().mockResolvedValue(undefined),
          replyWithPhoto: vi.fn().mockResolvedValue(undefined),
          api: {
            getFile: vi.fn().mockResolvedValue({
              file_id: 'doc-id',
              file_size: 200,
              download: vi.fn().mockResolvedValue('/tmp/input.jpg'),
            }),
          },
          message: { document: { file_id: 'doc-id', file_size: 200, mime_type: 'image/jpeg' } },
        } as unknown as CustomContext

        await handler.events['msg:document']!(docCtx)

        expect(vi.mocked(fs.stat)).toHaveBeenLastCalledWith('/tmp/input.jpg')
        expect(checkLimitsSpy).toHaveBeenLastCalledWith(docCtx, { fileSize: 102400 })
        expect(docCtx.reply).not.toHaveBeenCalledWith(expect.stringContaining('Image Info'))
      })

      it('should ignore non-image documents', async () => {
        const docCtx = {
          session: { command: CommandEnum.Info, params: null },
          t: vi.fn(key => key),
          user: { id: 1 },
          from: { id: 1 },
          reply: vi.fn().mockResolvedValue(undefined),
          replyWithPhoto: vi.fn().mockResolvedValue(undefined),
          api: {},
          message: { document: { file_id: 'doc-id', file_size: 200, mime_type: 'application/pdf' } },
        } as unknown as CustomContext

        await handler.events['msg:document']!(docCtx)

        expect(docCtx.reply).not.toHaveBeenCalled()
      })
    })
  })
})
