import type { UserRepository } from '@/repositories/user.repository'
import type { ImageInfo } from '@/services/image-downloader.service'
import type { CustomContext } from '@/types/custom-context.type'
import { GrammyError, InputFile } from 'grammy'
import { MAX_FILE_SIZE, MAX_PRO_FILE_SIZE } from '@/config/constants'
import { CommandEnum } from '@/enums/command.enum'
import { PlanTypeEnum } from '@/enums/plan-type.enum'
import { ImageInvalidUrlError, ImageNotImageError, ImageSendError, ImageSsrfBlockError, ImageTooLargeError, UserNotFoundError } from '@/errors'
import { ImageDownloaderService } from '@/services/image-downloader.service'
import { BaseHandler } from './base.handler'

const TELEGRAM_PHOTO_MAX_BYTES = 10 * 1024 * 1024
const TELEGRAM_PHOTO_MAX_DIMENSIONS_SUM = 10_000
const TELEGRAM_PHOTO_MAX_ASPECT_RATIO = 20
const TELEGRAM_PHOTO_FORMATS = new Set(['JPEG', 'PNG'])

function canSendAsPhoto(info: ImageInfo): boolean {
  if (!TELEGRAM_PHOTO_FORMATS.has(info.format) || info.sizeBytes > TELEGRAM_PHOTO_MAX_BYTES || !info.width || !info.height) {
    return false
  }

  const longest = Math.max(info.width, info.height)
  const shortest = Math.min(info.width, info.height)
  return info.width + info.height <= TELEGRAM_PHOTO_MAX_DIMENSIONS_SUM
    && longest / shortest <= TELEGRAM_PHOTO_MAX_ASPECT_RATIO
}

function imageExtension(format: string): string {
  switch (format.toLowerCase()) {
    case 'jpeg': return '.jpg'
    case 'png': return '.png'
    case 'webp': return '.webp'
    case 'gif': return '.gif'
    case 'avif': return '.avif'
    case 'tiff': return '.tif'
    default: return '.bin'
  }
}

function maxFileSize(ctx: CustomContext): number {
  if (ctx.user?.plan_type === PlanTypeEnum.Pro) {
    return MAX_PRO_FILE_SIZE
  }
  return MAX_FILE_SIZE
}

function formatChannels(channels?: number, colorSpace?: string): string {
  switch (channels) {
    case 1: return 'Grayscale'
    case 2: return 'Grayscale + Alpha'
    case 3: return 'RGB'
    case 4:
      if (colorSpace === 'cmyk') {
        return 'CMYK'
      }
      return 'RGBA'
    default: return `${channels ?? '—'} channels`
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export class DownloadHandler extends BaseHandler {
  public readonly command = CommandEnum.Download
  public readonly description = '🔗 Download an image from a URL'

  constructor(
    private readonly userRepository: UserRepository,
    private readonly downloader: ImageDownloaderService = new ImageDownloaderService(),
  ) {
    super()
  }

  public readonly events = {
    message: async (ctx: CustomContext) => {
      try {
        if (!ctx.user) {
          throw new UserNotFoundError()
        }

        if (ctx.session.command !== CommandEnum.Download) {
          return
        }

        if (!ctx.message?.text) {
          await ctx.reply(ctx.t('download_prompt'))
          return
        }

        const url = this.extractUrl(ctx.message.text)
        if (!url) {
          await ctx.reply(ctx.t('download_invalid_url'))
          await this.resetSession(ctx)
          return
        }

        await this.runWithUsage(ctx, this.userRepository, async () => {
          const info = await this.downloader.downloadAndAnalyze(url, maxFileSize(ctx))
          const inputFile = new InputFile(info.buffer, `download-image${imageExtension(info.format)}`)
          const options = {
            caption: this.buildCaption(ctx, info),
          }

          try {
            if (canSendAsPhoto(info)) {
              await ctx.replyWithPhoto(inputFile, options).catch(async (error) => {
                if (!(error instanceof GrammyError)) {
                  throw error
                }
                this.logger.error(error)
                await ctx.replyWithDocument(inputFile, options)
              })
            }
            else {
              await ctx.replyWithDocument(inputFile, options)
            }
          }
          catch (error) {
            this.logger.error(error)
            throw new ImageSendError()
          }
        })

        await this.resetSession(ctx)
      }
      catch (error) {
        if (error instanceof ImageNotImageError) {
          await ctx.reply(ctx.t('download_not_image'))
        }
        else if (error instanceof ImageSendError) {
          await ctx.reply(ctx.t('download_send_failed'))
        }
        else if (error instanceof ImageSsrfBlockError) {
          await ctx.reply(ctx.t('download_ssrf_blocked'))
        }
        else if (error instanceof ImageTooLargeError) {
          await this.notifyLimitExceeded(ctx)
        }
        else if (error instanceof ImageInvalidUrlError) {
          await ctx.reply(ctx.t('download_invalid_url'))
        }
        else if (error instanceof UserNotFoundError) {
          this.logger.error(error)
          await ctx.reply(ctx.t('unexpected_error'))
        }
        else {
          this.logger.error(error)
          await ctx.reply(ctx.t('download_fetch_failed'))
        }

        await this.resetSession(ctx)
      }
    },
  }

  public async onCommand(ctx: CustomContext): Promise<void> {
    await this.setSessionCommand(ctx)
    await ctx.reply(ctx.t('download_prompt'))
  }

  /** Extract the first http(s) URL from text, dropping trailing punctuation and unbalanced closing parentheses. */
  private extractUrl(text: string): string | null {
    const match = text.match(/https?:\/\/[^\s<>"'[\]{}]+/)
    if (!match) {
      return null
    }

    let url = match[0].replace(/[.,;:!?]+$/, '')
    while (url.endsWith(')') && url.split(')').length > url.split('(').length) {
      url = url.slice(0, -1)
    }
    return url
  }

  private buildCaption(ctx: CustomContext, info: ImageInfo): string {
    const parts: string[] = []

    if (info.width && info.height) {
      parts.push(`📐 ${info.width}x${info.height}`)
    }

    parts.push(`🎨 ${info.format}`)

    if (info.channels) {
      parts.push(`📦 ${formatChannels(info.channels, info.colorSpace)}`)
    }

    parts.push(`💾 ${formatSize(info.sizeBytes)}`)

    return `✅ ${ctx.t('download_success')}\n\n${parts.join('\n')}`
  }
}
