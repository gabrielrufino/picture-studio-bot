import type { UserRepository } from '@/repositories/user.repository'
import type { CustomContext } from '@/types/custom-context.type'
import { Buffer } from 'node:buffer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandEnum } from '@/enums/command.enum'
import { InvalidFileError } from '@/errors/invalid-file.error'
import { LimitExceededError } from '@/errors/limit-exceeded.error'
import { CropHandler } from './crop.handler'

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
    metadata: vi.fn().mockResolvedValue({ width: 1000, height: 800 }),
    extract: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('cropped image data')),
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

describe(CropHandler.name, () => {
  let userRepository: UserRepository
  let handler: CropHandler
  let ctx: CustomContext

  beforeEach(() => {
    userRepository = {
      incrementUsage: vi.fn().mockResolvedValue({}),
      decrementUsage: vi.fn().mockResolvedValue({}),
    } as unknown as UserRepository

    handler = new CropHandler(userRepository)
    // @ts-expect-error logger is protected
    handler.logger = { error: vi.fn() } as any

    ctx = {
      session: { command: CommandEnum.Crop, params: null },
      t: vi.fn(key => key),
      user: { id: 1 },
      from: { id: 1 },
      reply: vi.fn().mockResolvedValue(undefined),
      replyWithPhoto: vi.fn().mockResolvedValue(undefined),
      message: { photo: [{ file_id: 'photo-id', file_size: 100 }] },
      api: {
        getFile: vi.fn().mockResolvedValue({
          file_id: 'photo-id',
          file_size: 100,
          download: vi.fn().mockResolvedValue('/tmp/input.jpg'),
        }),
      },
    } as unknown as CustomContext

    vi.clearAllMocks()
  })

  describe('instantiation', () => {
    it('should match command and description', () => {
      expect(handler.command).toBe(CommandEnum.Crop)
      expect(handler.description).toBe('✂️ Crop an image')
    })
  })

  describe(CropHandler.prototype.onCommand.name, () => {
    it('should prompt for file', async () => {
      ctx.session.command = null
      await handler.onCommand(ctx)
      expect(ctx.session.command).toBe(CommandEnum.Crop)
      expect(ctx.reply).toHaveBeenCalledWith('crop_send_file')
    })
  })

  describe('msg:photo', () => {
    it('should save file_id and prompt for dimensions', async () => {
      await handler.events['msg:photo']!(ctx)
      expect(ctx.session.params).toEqual({ file_id: 'photo-id' })
      expect(ctx.reply).toHaveBeenCalledWith('crop_send_dimensions')
    })

    it('should return early if no photo attached', async () => {
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({} as any)
      await handler.events['msg:photo']!(ctx)
      expect(ctx.reply).not.toHaveBeenCalled()
      expect(ctx.session.params).toBeNull()
    })

    it('should throw UserNotFoundError if no user', async () => {
      ctx.user = null as any
      await handler.events['msg:photo']!(ctx)
      expect(ctx.reply).toHaveBeenCalledWith('crop_error')
    })

    it('should ignore LimitExceededError from checkLimits in msg:photo', async () => {
      vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new LimitExceededError())
      await handler.events['msg:photo']!(ctx)
      expect(ctx.reply).not.toHaveBeenCalledWith('crop_error')
    })

    it('should ignore InvalidFileError from checkLimits in msg:photo', async () => {
      vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new InvalidFileError())
      await handler.events['msg:photo']!(ctx)
      expect(ctx.reply).not.toHaveBeenCalledWith('crop_error')
    })

    it('should log and reply on unexpected error in msg:photo', async () => {
      vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new Error('Unexpected'))
      await handler.events['msg:photo']!(ctx)
      expect(ctx.reply).toHaveBeenCalledWith('crop_error')
      expect((handler as any).logger.error).toHaveBeenCalled()
    })
  })

  describe('message', () => {
    it('should crop image when valid dimensions are provided', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: '800x600' } as any)

      await handler.events.message!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('crop_processing')
      expect(ctx.replyWithPhoto).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'cropped.jpg' }),
        { caption: 'crop_success' },
      )
      expect(userRepository.incrementUsage).toHaveBeenCalledWith(1, 3)
      expect(ctx.session.command).toBeNull()
      expect(ctx.session.params).toBeNull()
    })

    it('should reply invalid dimensions for non-matching text', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'invalid' } as any)

      await handler.events.message!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('crop_invalid_dimensions')
      expect(ctx.replyWithPhoto).not.toHaveBeenCalled()
    })

    it('should reply invalid dimensions for zero values', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: '0x0' } as any)

      await handler.events.message!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('crop_invalid_dimensions')
      expect(ctx.replyWithPhoto).not.toHaveBeenCalled()
    })

    it('should reply invalid dimensions for out-of-bounds values', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: '5000x5000' } as any)

      await handler.events.message!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('crop_invalid_dimensions')
      expect(ctx.replyWithPhoto).not.toHaveBeenCalled()
    })

    it('should return early if no text in message', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({} as any)

      await handler.events.message!(ctx)

      expect(ctx.reply).not.toHaveBeenCalled()
    })

    it('should throw UserNotFoundError if no user', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: '800x600' } as any)
      ctx.user = null as any

      await handler.events.message!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('crop_error')
    })

    it('should ignore LimitExceededError gracefully', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: '800x600' } as any)
      vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new LimitExceededError())

      await handler.events.message!(ctx)

      expect(ctx.reply).not.toHaveBeenCalledWith('crop_error')
    })

    it('should reply invalid file message on InvalidFileError', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: '800x600' } as any)
      vi.spyOn(handler as any, 'validateImageFile').mockRejectedValueOnce(new InvalidFileError())

      await handler.events.message!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('crop_invalid_file')
      expect(ctx.replyWithPhoto).not.toHaveBeenCalled()
    })

    it('should reply error on unexpected error', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: '800x600' } as any)
      vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new Error('Unexpected'))

      await handler.events.message!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('crop_error')
      expect((handler as any).logger.error).toHaveBeenCalled()
    })
  })
})
