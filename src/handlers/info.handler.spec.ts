import type { UserRepository } from '@/repositories/user.repository'
import type { CustomContext } from '@/types/custom-context.type'
import fs from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandEnum } from '@/enums/command.enum'
import { InvalidFileError } from '@/errors/invalid-file.error'
import { LimitExceededError } from '@/errors/limit-exceeded.error'
import { InfoHandler } from './info.handler'

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
      t: vi.fn(key => key),
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

  describe('events', () => {
    describe('msg:photo', () => {
      it('should successfully read image info and send result', async () => {
        await handler.events['msg:photo']!(ctx)

        expect(ctx.reply).toHaveBeenCalledWith('info_processing')
        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining('info_result'),
          { parse_mode: 'HTML' },
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
  })
})
