import type { UserRepository } from '@/repositories/user.repository'
import type { CustomContext } from '@/types/custom-context.type'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import { InlineKeyboard } from 'grammy'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandEnum } from '@/enums/command.enum'
import { InvalidFileError } from '@/errors/invalid-file.error'
import { LimitExceededError } from '@/errors/limit-exceeded.error'
import { ConvertHandler } from './convert.handler'

vi.mock('node:fs/promises', () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
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
    toFormat: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('converted image data')),
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

describe(ConvertHandler.name, () => {
  let userRepository: UserRepository
  let handler: ConvertHandler
  let ctx: CustomContext

  beforeEach(() => {
    userRepository = {
      incrementUsage: vi.fn().mockResolvedValue({}),
      decrementUsage: vi.fn().mockResolvedValue({}),
    } as unknown as UserRepository

    handler = new ConvertHandler(userRepository)
    // @ts-expect-error logger is protected
    handler.logger = { error: vi.fn() } as any

    ctx = {
      session: { command: CommandEnum.Convert, params: null },
      t: vi.fn(key => key),
      user: { id: 1 },
      from: { id: 1 },
      reply: vi.fn().mockResolvedValue(undefined),
      replyWithDocument: vi.fn().mockResolvedValue(undefined),
      editMessageText: vi.fn().mockResolvedValue(undefined),
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      api: {
        getFile: vi.fn().mockResolvedValue({
          file_id: 'photo-id',
          file_size: 100,
          download: vi.fn().mockResolvedValue('/tmp/input.jpg'),
        }),
      },
      getFile: vi.fn().mockResolvedValue({
        download: vi.fn().mockResolvedValue('/tmp/input.jpg'),
      }),
      message: { photo: [{ file_id: 'photo-id', file_size: 100 }] },
      callbackQuery: { data: 'convert_jpeg' },
    } as unknown as CustomContext

    vi.clearAllMocks()
  })

  describe('instantiation', () => {
    it('should match command and description', () => {
      expect(handler.command).toBe(CommandEnum.Convert)
      expect(handler.description).toBe('🔄 Convert an image format')
    })
  })

  describe(ConvertHandler.prototype.onCommand.name, () => {
    it('should prompt for file', async () => {
      ctx.session.command = null
      await handler.onCommand(ctx)
      expect(ctx.session.command).toBe(CommandEnum.Convert)
      expect(ctx.reply).toHaveBeenCalledWith('convert_send_file')
    })
  })

  describe('msg:photo', () => {
    it('should save file_id and show format keyboard', async () => {
      await handler.events['msg:photo']!(ctx)
      expect(ctx.session.params).toEqual({ file_id: 'photo-id' })
      expect(ctx.reply).toHaveBeenCalledWith('convert_choose_format', {
        reply_markup: expect.any(InlineKeyboard),
      })
    })

    it('should throw UserNotFoundError if no user', async () => {
      ctx.user = null as any
      await handler.events['msg:photo']!(ctx)
      expect(ctx.reply).toHaveBeenCalledWith('convert_error')
    })

    it('should return silently on LimitExceededError in msg:photo', async () => {
      vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new LimitExceededError())
      await handler.events['msg:photo']!(ctx)
      expect(ctx.reply).not.toHaveBeenCalledWith('convert_error')
    })

    it('should return silently on InvalidFileError in msg:photo', async () => {
      vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new InvalidFileError())
      await handler.events['msg:photo']!(ctx)
      expect(ctx.reply).not.toHaveBeenCalledWith('convert_error')
    })
  })

  describe('callback_query', () => {
    it('should download, convert, and send photo', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      await handler.events.callback_query!(ctx)

      expect(ctx.answerCallbackQuery).toHaveBeenCalled()
      expect(ctx.editMessageText).toHaveBeenCalledWith('convert_converting')
      expect(ctx.replyWithDocument).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'converted.jpg', path: expect.stringMatching(/convert-[a-f0-9-]+\.jpg$/) }),
        { caption: 'convert_success' },
      )

      expect(userRepository.incrementUsage).toHaveBeenCalledWith(1, 3)
      expect(ctx.session.command).toBeNull()
      expect(ctx.session.params).toBeNull()
    })

    it('should ignore non-convert callbacks', async () => {
      ctx.callbackQuery!.data = 'other'
      await handler.events.callback_query!(ctx)
      expect(ctx.editMessageText).not.toHaveBeenCalled()
    })

    it('should ignore LimitExceededError gracefully', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new LimitExceededError())

      await handler.events.callback_query!(ctx)

      expect(ctx.reply).not.toHaveBeenCalledWith('convert_error')
    })

    it('should reply error on unexpected error in callback_query', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new Error('Unexpected'))

      await handler.events.callback_query!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('convert_error')
      expect((handler as any).logger.error).toHaveBeenCalled()
    })

    it('should handle fs.rm errors in finally block', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      const err1 = new Error('rm input error')
      const err2 = new Error('rm output error')

      vi.mocked(fs.rm).mockRejectedValueOnce(err1).mockRejectedValueOnce(err2)

      await handler.events.callback_query!(ctx)

      expect((handler as any).logger.error).toHaveBeenCalledWith({ error: err1, path: '/tmp/input.jpg' }, 'Failed to remove input file.')
      expect((handler as any).logger.error).toHaveBeenCalledWith(
        { error: err2, path: expect.stringMatching(/convert-/) },
        'Failed to remove output file.',
      )
    })
  })
})
