import type { UserRepository } from '@/repositories/user.repository'
import type { CustomContext } from '@/types/custom-context.type'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import { InlineKeyboard } from 'grammy'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandEnum } from '@/enums/command.enum'
import { InvalidFileError } from '@/errors/invalid-file.error'
import { LimitExceededError } from '@/errors/limit-exceeded.error'
import { RotateHandler } from './rotate.handler'

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
    rotate: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('rotated image data')),
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

describe(RotateHandler.name, () => {
  let userRepository: UserRepository
  let handler: RotateHandler
  let ctx: CustomContext

  beforeEach(() => {
    userRepository = {
      incrementUsage: vi.fn().mockResolvedValue({}),
      decrementUsage: vi.fn().mockResolvedValue({}),
    } as unknown as UserRepository

    handler = new RotateHandler(userRepository)
    // @ts-expect-error logger is protected
    handler.logger = { error: vi.fn() } as any

    ctx = {
      session: { command: CommandEnum.Rotate, params: null },
      t: vi.fn(key => key),
      user: { id: 1 },
      from: { id: 1 },
      reply: vi.fn().mockResolvedValue(undefined),
      replyWithPhoto: vi.fn().mockResolvedValue(undefined),
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
      callbackQuery: { data: 'rotate_90' },
    } as unknown as CustomContext

    vi.clearAllMocks()
  })

  describe('instantiation', () => {
    it('should match command and description', () => {
      expect(handler.command).toBe(CommandEnum.Rotate)
      expect(handler.description).toBe('🔄 Rotate an image')
    })
  })

  describe(RotateHandler.prototype.onCommand.name, () => {
    it('should prompt for file', async () => {
      ctx.session.command = null
      await handler.onCommand(ctx)
      expect(ctx.session.command).toBe(CommandEnum.Rotate)
      expect(ctx.reply).toHaveBeenCalledWith('rotate_send_file')
    })
  })

  describe('msg:photo', () => {
    it('should save file_id and show inline keyboard', async () => {
      await handler.events['msg:photo']!(ctx)
      expect(ctx.session.params).toEqual({ file_id: 'photo-id' })
      expect(ctx.reply).toHaveBeenCalledWith('rotate_choose_degrees', {
        reply_markup: expect.any(InlineKeyboard),
      })
    })

    it('should throw UserNotFoundError if no user', async () => {
      ctx.user = null as any
      await handler.events['msg:photo']!(ctx)
      expect(ctx.reply).toHaveBeenCalledWith('rotate_error')
    })

    it('should return early if no photo attached in msg:photo', async () => {
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({} as any)
      await handler.events['msg:photo']!(ctx)
      expect(ctx.reply).not.toHaveBeenCalled()
      expect(ctx.session.params).toBeNull()
    })

    it('should ignore LimitExceededError from checkLimits in msg:photo', async () => {
      vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new LimitExceededError())
      await handler.events['msg:photo']!(ctx)
      expect(ctx.reply).not.toHaveBeenCalledWith('rotate_error')
    })

    it('should ignore InvalidFileError from checkLimits in msg:photo', async () => {
      vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new InvalidFileError())
      await handler.events['msg:photo']!(ctx)
      expect(ctx.reply).not.toHaveBeenCalledWith('rotate_error')
    })
  })

  describe('callback_query', () => {
    it('should download, rotate, and send photo', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      await handler.events.callback_query!(ctx)

      expect(ctx.answerCallbackQuery).toHaveBeenCalled()
      expect(ctx.editMessageText).toHaveBeenCalledWith('rotate_rotating')
      expect(ctx.replyWithPhoto).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'rotated.jpg', path: expect.stringMatching(/rotate-[a-f0-9-]+\.jpg$/) }),
        { caption: 'rotate_success' },
      )

      expect(sharp).toHaveBeenCalledWith('/tmp/input.jpg')
      expect(sharp().rotate).toHaveBeenCalledWith(90)
      expect(fs.writeFile).toHaveBeenCalledWith(expect.stringMatching(/rotate-[a-f0-9-]+\.jpg$/), expect.any(Buffer))
      expect(fs.rm).toHaveBeenCalledWith('/tmp/input.jpg', { force: true })
      expect(fs.rm).toHaveBeenCalledWith(expect.stringMatching(/rotate-[a-f0-9-]+\.jpg$/), { force: true })

      expect(userRepository.incrementUsage).toHaveBeenCalledWith(1, 3)
      expect(ctx.session.command).toBeNull()
      expect(ctx.session.params).toBeNull()
    })

    it('should rotate with negative degrees correctly', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      ctx.callbackQuery!.data = 'rotate_-90'
      await handler.events.callback_query!(ctx)

      expect(ctx.answerCallbackQuery).toHaveBeenCalled()
      expect(sharp().rotate).toHaveBeenCalledWith(-90)
    })

    it('should rotate with 180 degrees correctly', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      ctx.callbackQuery!.data = 'rotate_180'
      await handler.events.callback_query!(ctx)

      expect(ctx.answerCallbackQuery).toHaveBeenCalled()
      expect(sharp().rotate).toHaveBeenCalledWith(180)
    })

    it('should throw UserNotFoundError if no user in callback', async () => {
      ctx.user = null as any
      await handler.events.callback_query!(ctx)
      expect(ctx.reply).toHaveBeenCalledWith('rotate_error')
    })

    it('should ignore LimitExceededError gracefully', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new LimitExceededError())

      await handler.events.callback_query!(ctx)

      expect(ctx.reply).not.toHaveBeenCalledWith('rotate_error')
    })

    it('should reply error on unexpected error in callback_query', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new Error('Unexpected'))

      await handler.events.callback_query!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('rotate_error')
      expect((handler as any).logger.error).toHaveBeenCalled()
    })

    it('should handle fs.rm errors', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      const err1 = new Error('rm input error')
      const err2 = new Error('rm output error')

      vi.mocked(fs.rm).mockRejectedValueOnce(err1).mockRejectedValueOnce(err2)

      await handler.events.callback_query!(ctx)

      expect((handler as any).logger.error).toHaveBeenCalledWith({ error: err1, path: '/tmp/input.jpg' }, 'Failed to remove input file.')
      expect((handler as any).logger.error).toHaveBeenCalledWith(
        { error: err2, path: expect.stringMatching(/rotate-[a-f0-9-]+\.jpg$/) },
        'Failed to remove output file.',
      )
    })

    it('should ignore non-rotate callbacks', async () => {
      ctx.callbackQuery!.data = 'other'
      await handler.events.callback_query!(ctx)
      expect(ctx.editMessageText).not.toHaveBeenCalled()
    })

    it('should handle missing degrees', async () => {
      ctx.callbackQuery!.data = 'rotate_'
      await handler.events.callback_query!(ctx)
      expect(ctx.editMessageText).not.toHaveBeenCalled()
    })

    it('should handle invalid degrees', async () => {
      ctx.callbackQuery!.data = 'rotate_45'
      await handler.events.callback_query!(ctx)
      expect(ctx.editMessageText).not.toHaveBeenCalled()
    })
  })
})
