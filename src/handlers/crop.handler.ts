import type { UserRepository } from '@/repositories/user.repository'
import type { CustomContext } from '@/types/custom-context.type'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { InputFile } from 'grammy'
import sharp from 'sharp'
import { CommandEnum } from '@/enums/command.enum'
import { InvalidFileError } from '@/errors/invalid-file.error'
import { LimitExceededError } from '@/errors/limit-exceeded.error'
import { UserNotFoundError } from '@/errors/user-not-found.error'
import { CropParamsSchema } from '@/schemas'
import { BaseHandler } from './base.handler'

export class CropHandler extends BaseHandler {
  public readonly command = CommandEnum.Crop
  public readonly description = '✂️ Crop an image'

  constructor(private readonly userRepository: UserRepository) {
    super()
  }

  public readonly events = {
    'msg:photo': async (ctx: CustomContext) => {
      try {
        if (!ctx.user) {
          throw new UserNotFoundError()
        }

        if (!ctx.message?.photo)
          return
        const photo = ctx.message.photo[ctx.message.photo.length - 1]
        const fileSize = photo.file_size ?? 0
        await this.checkLimits(ctx, { fileSize })

        ctx.session.params = {
          file_id: photo.file_id,
        }

        await ctx.reply(ctx.t('crop_send_dimensions'))
      }
      catch (error) {
        if (error instanceof InvalidFileError || error instanceof LimitExceededError) {
          return
        }

        this.logger.error(error)
        await ctx.reply(ctx.t('crop_error'))
      }
    },
    'message': async (ctx: CustomContext) => {
      let inputPath: string | undefined
      let outputPath: string | undefined
      let shouldResetSession = false

      try {
        if (!ctx.user) {
          shouldResetSession = true
          throw new UserNotFoundError()
        }

        if (!ctx.message?.text)
          return

        const match = ctx.message.text.match(/^(\d+)x(\d+)$/)
        if (!match) {
          await ctx.reply(ctx.t('crop_invalid_dimensions'))
          return
        }

        const width = Number(match[1])
        const height = Number(match[2])

        if (width <= 0 || height <= 0 || width > 4096 || height > 4096) {
          await ctx.reply(ctx.t('crop_invalid_dimensions'))
          return
        }

        shouldResetSession = true

        const { file_id: fileId } = this.validateParams(CropParamsSchema, ctx.session.params)

        await ctx.reply(ctx.t('crop_processing'))

        const file = await ctx.api.getFile(fileId)
        const fileSize = file.file_size ?? 0
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

          const cropWidth = Math.min(width, metadata.width)
          const cropHeight = Math.min(height, metadata.height)
          const left = Math.floor((metadata.width - cropWidth) / 2)
          const top = Math.floor((metadata.height - cropHeight) / 2)

          const buffer = await sharp(inputPath)
            .extract({ width: cropWidth, height: cropHeight, left, top })
            .toBuffer()

          outputPath = join(os.tmpdir(), `crop-${crypto.randomUUID()}.jpg`)
          await fs.writeFile(outputPath, buffer)

          const croppedFile = new InputFile(outputPath, 'cropped.jpg')
          await ctx.replyWithPhoto(croppedFile, {
            caption: ctx.t('crop_success'),
          })
        })
      }
      catch (error) {
        if (error instanceof LimitExceededError) {
          return
        }

        if (error instanceof InvalidFileError) {
          await ctx.reply(ctx.t('crop_invalid_file'))
          return
        }

        this.logger.error(error)
        await ctx.reply(ctx.t('crop_error'))
      }
      finally {
        if (inputPath) {
          await fs.rm(inputPath, { force: true }).catch(error =>
            this.logger.error({ error, path: inputPath }, 'Failed to remove input file.'),
          )
        }
        if (outputPath) {
          await fs.rm(outputPath, { force: true }).catch(error =>
            this.logger.error({ error, path: outputPath }, 'Failed to remove output file.'),
          )
        }
        if (shouldResetSession) {
          await this.resetSession(ctx)
        }
      }
    },
  }

  public async onCommand(ctx: CustomContext): Promise<void> {
    await this.setSessionCommand(ctx)
    await ctx.reply(ctx.t('crop_send_file'))
  }
}
