import type { UserRepository } from '@/repositories/user.repository'
import type { CustomContext } from '@/types/custom-context.type'
import fs from 'node:fs/promises'
import sharp from 'sharp'
import { CommandEnum } from '@/enums/command.enum'
import { InvalidFileError } from '@/errors/invalid-file.error'
import { LimitExceededError } from '@/errors/limit-exceeded.error'
import { UserNotFoundError } from '@/errors/user-not-found.error'
import { BaseHandler } from './base.handler'

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
        await this.checkLimits(ctx, { fileSize })

        await this.runWithUsage(ctx, this.userRepository, async () => {
          inputPath = await file.download()

          if (!inputPath) {
            throw new Error('Failed to download file')
          }

          const metadata = await this.validateImageFile(inputPath)

          if (!metadata.width || !metadata.height) {
            throw new InvalidFileError()
          }

          const stats = await fs.stat(inputPath)
          const sizeKB = (stats.size / 1024).toFixed(1)
          const format = (metadata.format || 'unknown').toUpperCase()

          await ctx.reply(
            ctx.t('info_result')
              .replace('{width}', String(metadata.width))
              .replace('{height}', String(metadata.height))
              .replace('{format}', format)
              .replace('{size}', `${sizeKB} KB`),
            { parse_mode: 'HTML' },
          )
        })
      }
      catch (error) {
        if (error instanceof InvalidFileError || error instanceof LimitExceededError) {
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
}
