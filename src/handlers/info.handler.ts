import type { UserRepository } from '@/repositories/user.repository'
import type { CustomContext } from '@/types/custom-context.type'
import fs from 'node:fs/promises'
import { CommandEnum } from '@/enums/command.enum'
import { InvalidFileError } from '@/errors/invalid-file.error'
import { LimitExceededError } from '@/errors/limit-exceeded.error'
import { UserNotFoundError } from '@/errors/user-not-found.error'
import { formatString } from '@/utils/format.util'
import { BaseHandler } from './base.handler'

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
])

export class InfoHandler extends BaseHandler {
  public readonly command = CommandEnum.Info
  public readonly description = 'ℹ️ Get image info'

  constructor(private readonly userRepository: UserRepository) {
    super()
  }

  public readonly events = {
    'msg:photo': async (ctx: CustomContext) => {
      let inputPath: string | undefined

      try {
        if (!ctx.user) {
          throw new UserNotFoundError()
        }

        if (!ctx.message?.photo)
          return
        const photo = ctx.message.photo[ctx.message.photo.length - 1]
        const fileSize = photo.file_size ?? 0
        await this.checkLimits(ctx, { fileSize })

        await ctx.reply(ctx.t('info_processing'))

        const file = await ctx.api.getFile(photo.file_id)

        await this.runWithUsage(ctx, this.userRepository, async () => {
          inputPath = await file.download()

          if (!inputPath) {
            throw new Error('Failed to download file')
          }

          const stats = await fs.stat(inputPath)
          await this.checkLimits(ctx, { fileSize: stats.size })

          const metadata = await this.handleImageInfo(inputPath)
          const sizeKB = (stats.size / 1024).toFixed(1)

          await ctx.reply(
            formatString(ctx.t('info_result'), {
              width: String(metadata.width),
              height: String(metadata.height),
              format: (metadata.format || 'unknown').toUpperCase(),
              size: `${sizeKB} KB`,
            }),
            { parse_mode: 'HTML' },
          )
        })
      }
      catch (error) {
        if (error instanceof InvalidFileError) {
          await ctx.reply(ctx.t('info_invalid_file'))
          return
        }

        if (error instanceof LimitExceededError) {
          return
        }

        this.logger.error(error)
        await ctx.reply(ctx.t('info_error'))
      }
      finally {
        if (inputPath) {
          await fs.rm(inputPath, { force: true }).catch(error =>
            this.logger.error({ error, path: inputPath }, 'Failed to remove input file.'),
          )
        }
        await this.resetSession(ctx)
      }
    },
    'msg:document': async (ctx: CustomContext) => {
      let inputPath: string | undefined

      try {
        if (!ctx.user) {
          throw new UserNotFoundError()
        }

        const document = ctx.message?.document
        if (!document) {
          return
        }

        if (!this.isImageDocument(document)) {
          return
        }

        await this.checkLimits(ctx, { fileSize: document.file_size })

        await ctx.reply(ctx.t('info_processing'))

        await this.runWithUsage(ctx, this.userRepository, async () => {
          const file = await ctx.api.getFile(document.file_id)
          inputPath = await file.download()

          if (!inputPath) {
            throw new Error('Failed to download file')
          }

          const stats = await fs.stat(inputPath)
          await this.checkLimits(ctx, { fileSize: stats.size })

          const metadata = await this.handleImageInfo(inputPath)
          const sizeKB = (stats.size / 1024).toFixed(1)

          await ctx.reply(
            formatString(ctx.t('info_result'), {
              width: String(metadata.width),
              height: String(metadata.height),
              format: (metadata.format || 'unknown').toUpperCase(),
              size: `${sizeKB} KB`,
            }),
            { parse_mode: 'HTML' },
          )
        })
      }
      catch (error) {
        if (error instanceof InvalidFileError) {
          await ctx.reply(ctx.t('info_invalid_file'))
          return
        }

        if (error instanceof LimitExceededError) {
          return
        }

        this.logger.error(error)
        await ctx.reply(ctx.t('info_error'))
      }
      finally {
        if (inputPath) {
          await fs.rm(inputPath, { force: true }).catch(error =>
            this.logger.error({ error, path: inputPath }, 'Failed to remove input file.'),
          )
        }
        await this.resetSession(ctx)
      }
    },
  }

  public async onCommand(ctx: CustomContext): Promise<void> {
    await this.setSessionCommand(ctx)
    await ctx.reply(ctx.t('info_send_file'))
  }

  private isImageDocument(document?: { mime_type?: string }): boolean {
    const mimeType = document?.mime_type
    return Boolean(mimeType && IMAGE_MIME_TYPES.has(mimeType))
  }

  private async handleImageInfo(inputPath: string): Promise<{ width?: number, height?: number, format?: string }> {
    const metadata = await this.validateImageFile(inputPath)
    if (!metadata.width || !metadata.height) {
      throw new InvalidFileError()
    }
    return metadata
  }
}
