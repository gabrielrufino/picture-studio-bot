import type { UserRepository } from '../repositories/user.repository'
import type { CustomContext } from '../types/custom-context.type'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandEnum } from '../enums/command.enum'
import { LimitExceededError } from '../errors/limit-exceeded.error'
import { ResizeHandler } from './resize.handler'

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
    resize: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('resized image data')),
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

describe(ResizeHandler.name, () => {
  let userRepository: UserRepository
  let handler: ResizeHandler
  let ctx: CustomContext

  beforeEach(() => {
    userRepository = {
      incrementUsage: vi.fn().mockResolvedValue({}),
      decrementUsage: vi.fn().mockResolvedValue({}),
    } as unknown as UserRepository

    handler = new ResizeHandler(userRepository)
    // @ts-expect-error logger is protected
    handler.logger = { error: vi.fn() } as any

    ctx = {
      session: { command: CommandEnum.Resize, params: null },
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
      callbackQuery: { data: 'resize_256_256' },
    } as unknown as CustomContext

    vi.clearAllMocks()
  })

  describe('instantiation', () => {
    it('should match command and description', () => {
      expect(handler.command).toBe(CommandEnum.Resize)
      expect(handler.description).toBe('📐 Resize an image')
    })
  })

  describe(ResizeHandler.prototype.onCommand.name, () => {
    it('should prompt for file', async () => {
      ctx.session.command = null
      await handler.onCommand(ctx)
      expect(ctx.session.command).toBe(CommandEnum.Resize)
      expect(ctx.reply).toHaveBeenCalledWith('resize_send_file')
    })
  })

  describe('msg:photo', () => {
    it('should throw UserNotFoundError if no user', async () => {
      ctx.user = null as any
      await handler.events['msg:photo']!(ctx)
      expect(ctx.reply).toHaveBeenCalledWith('resize_error')
    })
  })

  describe('callback_query', () => {
    it('should download, resize, and send photo', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      await handler.events.callback_query!(ctx)

      expect(ctx.answerCallbackQuery).toHaveBeenCalled()
      expect(ctx.editMessageText).toHaveBeenCalledWith('resize_resizing')
      expect(ctx.replyWithPhoto).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'resized.jpg', path: expect.stringMatching(/resize-[a-f0-9-]+\.jpg$/) }),
        { caption: 'resize_success' },
      )

      expect(sharp).toHaveBeenCalledWith('/tmp/input.jpg')
      expect(sharp().resize).toHaveBeenCalledWith(256, 256)
      expect(fs.writeFile).toHaveBeenCalledWith(expect.stringMatching(/resize-[a-f0-9-]+\.jpg$/), expect.any(Buffer))
      expect(fs.rm).toHaveBeenCalledWith('/tmp/input.jpg', { force: true })
      expect(fs.rm).toHaveBeenCalledWith(expect.stringMatching(/resize-[a-f0-9-]+\.jpg$/), { force: true })

      expect(userRepository.incrementUsage).toHaveBeenCalledWith(1, 3)
      expect(ctx.session.command).toBeNull()
      expect(ctx.session.params).toBeNull()
    })

    it('should ignore non-resize callbacks', async () => {
      ctx.callbackQuery!.data = 'other'
      await handler.events.callback_query!(ctx)
      expect(ctx.editMessageText).not.toHaveBeenCalled()
    })

    it('should ignore LimitExceededError gracefully', async () => {
      ctx.session.params = { file_id: 'photo-id' }
      vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new LimitExceededError())

      await handler.events.callback_query!(ctx)

      expect(ctx.reply).not.toHaveBeenCalledWith('resize_error')
    })
  })
})
