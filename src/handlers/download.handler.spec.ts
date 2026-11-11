import type { UserRepository } from '@/repositories/user.repository'
import type { ImageDownloaderService } from '@/services/image-downloader.service'
import type { CustomContext } from '@/types/custom-context.type'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import { GrammyError } from 'grammy'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FILE_SIZE, MAX_PRO_FILE_SIZE } from '@/config/constants'
import { CommandEnum } from '@/enums/command.enum'
import { PlanTypeEnum } from '@/enums/plan-type.enum'
import { ImageFetchError, ImageNotImageError, ImageTooLargeError } from '@/errors'
import { DownloadHandler } from './download.handler'

vi.mock('node:fs/promises', () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('image-data')),
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
    metadata: vi.fn().mockResolvedValue({
      width: 1920,
      height: 1080,
      channels: 3,
      format: 'jpeg',
    }),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('processed')),
  }),
}))

vi.mock('grammy', async () => {
  const actual = await vi.importActual<typeof import('grammy')>('grammy')
  return {
    ...actual,
    InputFile: class {
      constructor(public data: Buffer | string, public name: string) {}
    },
  }
})

const mockDownloadAndAnalyze = vi.fn().mockResolvedValue({
  format: 'JPEG',
  width: 1920,
  height: 1080,
  channels: 3,
  sizeBytes: 245760,
  buffer: Buffer.from('downloaded-image'),
})

describe(DownloadHandler.name, () => {
  let userRepository: UserRepository
  let handler: DownloadHandler
  let ctx: CustomContext
  let mockDownloader: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockDownloadAndAnalyze.mockResolvedValue({
      format: 'JPEG',
      width: 1920,
      height: 1080,
      channels: 3,
      sizeBytes: 245760,
      buffer: Buffer.from('downloaded-image'),
    })

    mockDownloader = {
      downloadAndAnalyze: mockDownloadAndAnalyze,
    } as any

    userRepository = {
      incrementUsage: vi.fn().mockResolvedValue({ plan_type: 'free', id: 1 }),
      decrementUsage: vi.fn().mockResolvedValue({ plan_type: 'free', id: 1 }),
    } as unknown as UserRepository

    handler = new DownloadHandler(userRepository, mockDownloader as unknown as ImageDownloaderService)

    // @ts-expect-error logger is protected
    handler.logger = {
      error: vi.fn(),
    } as any

    ctx = {
      session: { command: null, params: null },
      t: vi.fn(key => key),
      user: { id: 1, plan_type: 'free' },
      from: { id: 1 },
      reply: vi.fn().mockResolvedValue(undefined),
      replyWithDocument: vi.fn().mockResolvedValue(undefined),
      replyWithPhoto: vi.fn().mockResolvedValue(undefined),
      api: {},
      message: null,
      callbackQuery: undefined,
    } as unknown as CustomContext
  })

  describe('instantiation', () => {
    it('should match command and description', () => {
      expect(handler.command).toBe(CommandEnum.Download)
      expect(handler.description).toBe('🔗 Download an image from a URL')
    })
  })

  describe(DownloadHandler.prototype.onCommand.name, () => {
    it('should set session command and prompt for URL', async () => {
      ctx.session.command = null
      await handler.onCommand(ctx)
      expect(ctx.session.command).toBe(CommandEnum.Download)
      expect(ctx.reply).toHaveBeenCalledWith('download_prompt')
    })

    it('should clean temp files before setting session command', async () => {
      ctx.session.params = {
        paths: ['/tmp/old-file.jpg'],
      } as any
      await handler.onCommand(ctx)
      expect(fs.rm).toHaveBeenCalledWith('/tmp/old-file.jpg', { force: true, recursive: true })
    })
  })

  describe('message event (inline URL flow)', () => {
    it('should ignore messages when session is not in download mode', async () => {
      ctx.session.command = CommandEnum.Resize
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'https://example.com/img.jpg' } as any)

      await handler.events.message!(ctx)
      expect(ctx.reply).not.toHaveBeenCalled()
    })

    it('should prompt for a URL on non-text messages and keep the session', async () => {
      ctx.session.command = CommandEnum.Download
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: '' } as any)

      await handler.events.message!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('download_prompt')
      expect(ctx.session.command).toBe(CommandEnum.Download)
      expect(mockDownloadAndAnalyze).not.toHaveBeenCalled()
    })

    it('should send the original file as a document with metadata caption on valid URL', async () => {
      ctx.session.command = CommandEnum.Download
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'Check this out: https://example.com/image.jpg' } as any)

      await handler.events.message!(ctx)

      expect(ctx.replyWithDocument).toHaveBeenCalledOnce()
      const [inputFile] = vi.mocked(ctx.replyWithDocument).mock.calls![0]
      expect(inputFile).toBeInstanceOf(await import('grammy').then(m => m.InputFile))
      expect((inputFile as any).name).toContain('.jpg')
      expect(ctx.replyWithDocument).toHaveBeenCalledWith(
        expect.anything(),
        {
          caption: expect.stringContaining('✅ download_success'),
        },
      )
      expect(ctx.reply).not.toHaveBeenCalled()
      expect(userRepository.incrementUsage).toHaveBeenCalled()
      expect(ctx.session.command).toBeNull()
      expect(ctx.session.params).toBeNull()
    })

    it('should handle URLs without surrounding text', async () => {
      ctx.session.command = CommandEnum.Download
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'https://example.com/image.png' } as any)

      await handler.events.message!(ctx)

      expect(mockDownloadAndAnalyze).toHaveBeenCalledWith('https://example.com/image.png', MAX_FILE_SIZE)
      expect(ctx.replyWithDocument).toHaveBeenCalled()
    })

    it('should accept URLs with an uppercase scheme', async () => {
      ctx.session.command = CommandEnum.Download
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'HTTPS://EXAMPLE.COM/image.jpg' } as any)

      await handler.events.message!(ctx)

      expect(mockDownloadAndAnalyze).toHaveBeenCalledWith('HTTPS://EXAMPLE.COM/image.jpg', MAX_FILE_SIZE)
    })

    it('should reject invalid URLs', async () => {
      ctx.session.command = CommandEnum.Download
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'this is not a url' } as any)

      await handler.events.message!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('download_invalid_url')
      expect(ctx.session.command).toBeNull()
      expect(ctx.session.params).toBeNull()
      expect(mockDownloadAndAnalyze).not.toHaveBeenCalled()
      expect(userRepository.incrementUsage).not.toHaveBeenCalled()
    })

    it('should reject URLs with only http but no domain', async () => {
      ctx.session.command = CommandEnum.Download
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'http://' } as any)

      await handler.events.message!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('download_invalid_url')
    })

    it('should handle NotAnImageError from downloader', async () => {
      mockDownloadAndAnalyze.mockRejectedValueOnce(new ImageNotImageError())

      ctx.session.command = CommandEnum.Download
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'https://example.com/fake.txt' } as any)

      await handler.events.message!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('download_not_image')
      expect(ctx.session.command).toBeNull()
      expect(ctx.session.params).toBeNull()
      // runWithUsage increments on entry, decrements on caught error
      expect(userRepository.decrementUsage).toHaveBeenCalled()
    })

    it('should reply with a fetch failure without logging expected fetch errors', async () => {
      mockDownloadAndAnalyze.mockRejectedValueOnce(new ImageFetchError())

      ctx.session.command = CommandEnum.Download
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'https://example.com/missing.jpg' } as any)

      await handler.events.message!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('download_fetch_failed')
      // @ts-expect-error logger is protected
      expect(handler.logger.error).not.toHaveBeenCalled()
      expect(userRepository.decrementUsage).toHaveBeenCalled()
    })

    it('should log and reply with a fetch failure on unexpected errors', async () => {
      const unexpectedError = new Error('unexpected')
      mockDownloadAndAnalyze.mockRejectedValueOnce(unexpectedError)

      ctx.session.command = CommandEnum.Download
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'https://example.com/img.jpg' } as any)

      await handler.events.message!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('download_fetch_failed')
      // @ts-expect-error logger is protected
      expect(handler.logger.error).toHaveBeenCalledWith(unexpectedError)
      expect(userRepository.decrementUsage).toHaveBeenCalled()
      expect(ctx.session.command).toBeNull()
    })

    it('should reject files above the free plan size limit with a file size message', async () => {
      mockDownloadAndAnalyze.mockRejectedValueOnce(new ImageTooLargeError())

      ctx.session.command = CommandEnum.Download
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'https://example.com/big.jpg' } as any)

      await handler.events.message!(ctx)

      expect(mockDownloadAndAnalyze).toHaveBeenCalledWith('https://example.com/big.jpg', MAX_FILE_SIZE)
      expect(ctx.reply).toHaveBeenCalledWith('download_too_large')
      expect(ctx.reply).not.toHaveBeenCalledWith('free_limit_reached')
      expect(ctx.reply).not.toHaveBeenCalledWith('download_fetch_failed')
      expect(ctx.replyWithDocument).not.toHaveBeenCalled()
      expect(userRepository.decrementUsage).toHaveBeenCalled()
      expect(ctx.session.command).toBeNull()
    })

    it('should send files above the free plan size limit for Pro users', async () => {
      mockDownloadAndAnalyze.mockResolvedValueOnce({
        format: 'JPEG',
        width: 1920,
        height: 1080,
        channels: 3,
        sizeBytes: 11 * 1024 * 1024,
        buffer: Buffer.from('big-image'),
      })

      vi.mocked(userRepository.incrementUsage).mockResolvedValueOnce({ plan_type: PlanTypeEnum.Pro, id: 1 } as any)
      ctx.session.command = CommandEnum.Download
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'https://example.com/big.jpg' } as any)

      await handler.events.message!(ctx)

      expect(mockDownloadAndAnalyze).toHaveBeenCalledWith('https://example.com/big.jpg', MAX_PRO_FILE_SIZE)
      expect(ctx.replyWithDocument).toHaveBeenCalledOnce()
      expect(userRepository.decrementUsage).not.toHaveBeenCalled()
    })

    it('should send JPEG and PNG originals as documents instead of photos', async () => {
      mockDownloadAndAnalyze.mockResolvedValueOnce({
        format: 'PNG',
        width: 800,
        height: 600,
        channels: 4,
        sizeBytes: 100 * 1024,
        buffer: Buffer.from('png-image'),
      })

      ctx.session.command = CommandEnum.Download
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'https://example.com/image.png' } as any)

      await handler.events.message!(ctx)

      const [inputFile] = vi.mocked(ctx.replyWithDocument).mock.calls![0]
      expect((inputFile as any).name).toBe('download-image.png')
      expect(ctx.replyWithDocument).toHaveBeenCalledOnce()
      expect(ctx.replyWithPhoto).not.toHaveBeenCalled()
    })

    it('should send WebP images as documents', async () => {
      mockDownloadAndAnalyze.mockResolvedValueOnce({
        format: 'WEBP',
        width: 800,
        height: 600,
        channels: 3,
        sizeBytes: 100 * 1024,
        buffer: Buffer.from('webp-image'),
      })

      ctx.session.command = CommandEnum.Download
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'https://example.com/image.webp' } as any)

      await handler.events.message!(ctx)

      const [inputFile] = vi.mocked(ctx.replyWithDocument).mock.calls![0]
      expect((inputFile as any).name).toBe('download-image.webp')
      expect(ctx.replyWithDocument).toHaveBeenCalledOnce()
    })

    it('should describe two-channel images as grayscale with alpha', async () => {
      mockDownloadAndAnalyze.mockResolvedValueOnce({
        format: 'PNG',
        width: 100,
        height: 100,
        channels: 2,
        sizeBytes: 1024,
        buffer: Buffer.from('gray-alpha'),
      })

      ctx.session.command = CommandEnum.Download
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'https://example.com/ga.png' } as any)

      await handler.events.message!(ctx)

      expect(ctx.replyWithDocument).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        caption: expect.stringContaining('Grayscale + Alpha'),
      }))
    })

    it('should describe four-channel CMYK images as CMYK', async () => {
      mockDownloadAndAnalyze.mockResolvedValueOnce({
        format: 'JPEG',
        width: 100,
        height: 100,
        channels: 4,
        colorSpace: 'cmyk',
        sizeBytes: 1024,
        buffer: Buffer.from('cmyk'),
      })

      ctx.session.command = CommandEnum.Download
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'https://example.com/cmyk.jpg' } as any)

      await handler.events.message!(ctx)

      expect(ctx.replyWithDocument).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        caption: expect.stringContaining('CMYK'),
      }))
    })

    it('should reply with a send failure when Telegram rejects the document', async () => {
      ctx.session.command = CommandEnum.Download
      ctx.replyWithDocument = vi.fn().mockRejectedValue(new GrammyError('Bad Request: file is too big', { ok: false, error_code: 400, description: 'file is too big' }, 'sendDocument', {})) as any
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'https://example.com/image.jpg' } as any)

      await handler.events.message!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('download_send_failed')
      expect(userRepository.decrementUsage).toHaveBeenCalled()
      expect(ctx.session.command).toBeNull()
    })

    it('should reply with an unexpected error when the user is missing', async () => {
      ctx.session.command = CommandEnum.Download
      ctx.user = undefined
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'https://example.com/image.jpg' } as any)

      await handler.events.message!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('unexpected_error')
      expect(ctx.reply).not.toHaveBeenCalledWith('download_fetch_failed')
      expect(ctx.session.command).toBeNull()
    })

    it('should stop URLs at square and curly brackets', async () => {
      ctx.session.command = CommandEnum.Download
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: 'https://example.com/image.jpg}' } as any)

      await handler.events.message!(ctx)

      expect(mockDownloadAndAnalyze).toHaveBeenCalledWith('https://example.com/image.jpg', MAX_FILE_SIZE)
    })

    it('should strip trailing punctuation and unbalanced parentheses from the URL', async () => {
      ctx.session.command = CommandEnum.Download
      vi.spyOn(ctx, 'message', 'get').mockReturnValue({ text: '(see https://example.com/image.jpg).' } as any)

      await handler.events.message!(ctx)

      expect(mockDownloadAndAnalyze).toHaveBeenCalledWith('https://example.com/image.jpg', MAX_FILE_SIZE)
    })
  })
})
