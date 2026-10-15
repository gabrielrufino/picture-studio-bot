import type { UserRepository } from '@/repositories/user.repository'
import type { CustomContext } from '@/types/custom-context.type'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandEnum } from '@/enums/command.enum'
import { InvalidFileError } from '@/errors/invalid-file.error'
import { LimitExceededError } from '@/errors/limit-exceeded.error'
import { CropHandler } from './crop.handler'

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
      message: { photo: [{ file_id: 'photo-id', file_size: 100 }] },
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
})
