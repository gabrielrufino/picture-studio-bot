import type { UserRepository } from '../repositories/user.repository'
import type { CompressParams } from '../schemas'
import type { CustomContext } from '../types/custom-context.type'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { InputFile } from 'grammy'
import sharp from 'sharp'
import { CommandEnum } from '../enums/command.enum'
import { InvalidFileError } from '../errors/invalid-file.error'
import { LimitExceededError } from '../errors/limit-exceeded.error'
import { UserNotFoundError } from '../errors/user-not-found.error'
import { BaseHandler } from './base.handler'

export class CompressHandler extends BaseHandler {
  public readonly command = CommandEnum.Compress
  public readonly description = '🗜️ Compress an image'

  constructor(private readonly userRepository: UserRepository) {
    super()
  }

  public readonly events = {
    'msg:photo': async (ctx: CustomContext) => {
      let inputPath: string | undefined
      let outputPath: string | undefined

      try {
        if (!ctx.user) {
          throw new UserNotFoundError()
        }

        if (!ctx.message?.photo)
          return
        const photo = ctx.message.photo[ctx.message.photo.length - 1]
        const fileSize = photo.file_size ?? 0
        await this.checkLimits(ctx, { fileSize })

        await this.runWithUsage(ctx, this.userRepository, async () => {
          const file = await ctx.getFile()
          inputPath = await file.download()

          if (!inputPath) {
            throw new Error('Failed to download file')
          }

          await ctx.reply(ctx.t('compress_compressing'))

          const quality = (ctx.session.params as CompressParams)?.quality ?? 80

          const buffer = await sharp(inputPath)
            .jpeg({ quality })
            .toBuffer()

          const originalSize = (await fs.stat(inputPath)).size

          if (buffer.length >= originalSize) {
            await ctx.reply(ctx.t('compress_no_reduction'))
            return
          }

          outputPath = join(os.tmpdir(), `compress-${crypto.randomUUID()}.jpg`)
          await fs.writeFile(outputPath, buffer)

          const compressedFile = new InputFile(outputPath, 'compressed.jpg')
          await ctx.replyWithPhoto(compressedFile, {
            caption: ctx.t('compress_success'),
          })
        })
      }
      catch (error) {
        if (error instanceof InvalidFileError || error instanceof LimitExceededError) {
          return
        }

        this.logger.error(error)
        await ctx.reply(ctx.t('compress_error'))
      }
      finally {
        ctx.session.params = {
          paths: [inputPath, outputPath].filter(Boolean) as string[],
        } as CompressParams
        await this.resetSession(ctx)
      }
    },
  }

  public async onCommand(ctx: CustomContext): Promise<void> {
    await this.setSessionCommand(ctx)
    await ctx.reply(ctx.t('compress_send_file'))
  }
}
