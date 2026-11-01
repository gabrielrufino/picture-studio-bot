import type { UserRepository } from '@/repositories/user.repository'
import type { CustomContext } from '@/types/custom-context.type'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '@/config/logger'
import { PlanTypeEnum } from '@/enums/plan-type.enum'
import { InvalidFileError } from '@/errors/invalid-file.error'
import { CompressHandler } from './compress.handler'

vi.mock('node:fs/promises', () => ({
  default: {
    stat: vi.fn(),
    writeFile: vi.fn(),
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
    metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('compressed image data')),
  }),
}))

vi.mock('grammy', () => ({
  InputFile: vi.fn(),
}))

vi.mock('../config/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}))

describe(CompressHandler.name, () => {
  let userRepository: UserRepository
  let handler: CompressHandler
  let ctx: any

  beforeEach(() => {
    userRepository = {
      incrementUsage: vi.fn().mockResolvedValue({}),
      decrementUsage: vi.fn().mockResolvedValue({}),
    } as unknown as UserRepository
    handler = new CompressHandler(userRepository)

    ctx = {
      from: { id: 123 },
      user: {
        id: 123,
        plan_type: PlanTypeEnum.Free,
        daily_usage_count: 0,
        is_blocked: false,
        last_usage_date: new Date(),
      },
      t: vi.fn(key => key),
      reply: vi.fn(),
      replyWithPhoto: vi.fn(),
      getFile: vi.fn().mockResolvedValue({ download: vi.fn().mockResolvedValue('/tmp/input.jpg') }),
      session: { params: {} },
      message: { photo: [{ file_id: 'photo1', file_size: 100 }] },
    } as unknown as CustomContext
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe(CompressHandler.prototype.onCommand.name, () => {
    it('should ask for file', async () => {
      await handler.onCommand(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('compress_send_file')
      expect(ctx.session.command).toBe(handler.command)
    })
  })

  describe('events', () => {
    describe('msg:photo', () => {
      it('should successfully compress image and send the photo', async () => {
        vi.mocked(fs.stat).mockResolvedValue({ size: 200 } as any)

        const downloadMock = vi.fn().mockResolvedValue('/tmp/input.jpg')
        ctx.getFile = vi.fn().mockResolvedValue({ download: downloadMock })

        await handler.events['msg:photo']!(ctx)

        expect(ctx.reply).toHaveBeenCalledWith('compress_compressing')

        expect(fs.writeFile).toHaveBeenCalledWith(expect.stringMatching(/\/tmp\/compress-[a-f0-9-]+\.jpg/), expect.any(Buffer))
        expect(ctx.replyWithPhoto).toHaveBeenCalledWith(expect.any(Object), { caption: 'compress_success' })
        expect(userRepository.incrementUsage).toHaveBeenCalledWith(123, 3)
        expect(ctx.session.command).toBeNull()
        expect(ctx.session.params).toBeNull()
      })

      it('should reply with no_reduction message when compressed file is not smaller', async () => {
        vi.mocked(fs.stat).mockResolvedValue({ size: 50 } as any)
        vi.mocked(sharp).mockReturnValue({
          metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
          jpeg: vi.fn().mockReturnThis(),
          toBuffer: vi.fn().mockResolvedValue(Buffer.from('this buffer is larger than 50 bytes so no reduction happens')),
        } as any)

        const downloadMock = vi.fn().mockResolvedValue('/tmp/input.jpg')
        ctx.getFile = vi.fn().mockResolvedValue({ download: downloadMock })

        await handler.events['msg:photo']!(ctx)

        expect(ctx.reply).toHaveBeenCalledWith('compress_compressing')
        expect(ctx.reply).toHaveBeenCalledWith('compress_no_reduction')
        expect(ctx.replyWithPhoto).not.toHaveBeenCalled()
        expect(userRepository.incrementUsage).toHaveBeenCalledWith(123, 3)
      })

      it('should reply with error when user not found', async () => {
        ctx.user = null
        await handler.events['msg:photo']!(ctx)

        expect(logger.error).toHaveBeenCalled()
        expect(ctx.reply).toHaveBeenCalledWith('compress_error')
      })

      it('should return silently on LimitExceededError', async () => {
        ctx.message.photo[0].file_size = 99999999999
        await handler.events['msg:photo']!(ctx)

        expect(ctx.reply).toHaveBeenCalledWith('free_limit_reached')
        expect(logger.error).not.toHaveBeenCalled()
        expect(ctx.reply).not.toHaveBeenCalledWith('compress_error')
      })

      it('should reply with invalid file message on corrupt photo', async () => {
        vi.spyOn(handler as any, 'validateImageFile').mockRejectedValueOnce(new InvalidFileError())

        const downloadMock = vi.fn().mockResolvedValue('/tmp/input.jpg')
        ctx.getFile = vi.fn().mockResolvedValue({ download: downloadMock })

        await handler.events['msg:photo']!(ctx)

        expect(ctx.reply).toHaveBeenCalledWith('compress_invalid_file')
        expect(ctx.replyWithPhoto).not.toHaveBeenCalled()
        expect(logger.error).not.toHaveBeenCalled()
        expect(userRepository.incrementUsage).toHaveBeenCalledWith(123, 3)
        expect(userRepository.decrementUsage).toHaveBeenCalledWith(123)
      })

      it('should throw error when file download fails', async () => {
        ctx.getFile = vi.fn().mockResolvedValue({ download: vi.fn().mockResolvedValue(undefined) })

        await handler.events['msg:photo']!(ctx)

        expect(logger.error).toHaveBeenCalled()
        expect(ctx.reply).toHaveBeenCalledWith('compress_error')
      })
    })
  })
})
