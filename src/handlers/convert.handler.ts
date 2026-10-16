import type { UserRepository } from '@/repositories/user.repository'
import type { CustomContext } from '@/types/custom-context.type'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { InlineKeyboard, InputFile } from 'grammy'
import sharp from 'sharp'
import { CommandEnum } from '@/enums/command.enum'
import { InvalidFileError } from '@/errors/invalid-file.error'
import { LimitExceededError } from '@/errors/limit-exceeded.error'
import { UserNotFoundError } from '@/errors/user-not-found.error'
import { ConvertParamsSchema } from '@/schemas'
import { BaseHandler } from './base.handler'

export class ConvertHandler extends BaseHandler {
  public readonly command = CommandEnum.Convert
  public readonly description = '🔄 Convert an image format'

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

        const keyboard = new InlineKeyboard()
          .text('JPEG', 'convert_jpeg')
          .text('PNG', 'convert_png')
          .text('WebP', 'convert_webp')

        await ctx.reply(ctx.t('convert_choose_format'), {
          reply_markup: keyboard,
        })
      }
      catch (error) {
        if (error instanceof InvalidFileError || error instanceof LimitExceededError) {
          return
        }

        this.logger.error(error)
        await ctx.reply(ctx.t('convert_error'))
      }
    },
    'callback_query': async (ctx: CustomContext) => {
      let inputPath: string | undefined
      let outputPath: string | undefined

      try {
        if (!ctx.user) {
          throw new UserNotFoundError()
        }

        const data = ctx.callbackQuery?.data
        if (!data?.startsWith('convert_'))
          return

        const [, format] = data.split('_')
        if (!['jpeg', 'png', 'webp'].includes(format))
          return

        await ctx.answerCallbackQuery()

        const { file_id: fileId } = this.validateParams(ConvertParamsSchema, ctx.session.params)

        await ctx.editMessageText(ctx.t('convert_converting'))

        const file = await ctx.api.getFile(fileId)

        const fileSize = file.file_size ?? 0
        await this.checkLimits(ctx, { fileSize })

        await this.runWithUsage(ctx, this.userRepository, async () => {
          inputPath = await file.download()

          if (!inputPath) {
            throw new Error('Failed to download file')
          }

          const buffer = await sharp(inputPath)
            .toFormat(format as 'jpeg' | 'png' | 'webp')
            .toBuffer()

          const ext = format === 'jpeg' ? 'jpg' : format
          outputPath = join(os.tmpdir(), `convert-${crypto.randomUUID()}.${ext}`)
          await fs.writeFile(outputPath, buffer)

          const convertedFile = new InputFile(outputPath, `converted.${ext}`)
          await ctx.replyWithDocument(convertedFile, {
            caption: ctx.t('convert_success'),
          })
        })
      }
      catch (error) {
        if (error instanceof LimitExceededError) {
          return
        }

        this.logger.error(error)
        await ctx.reply(ctx.t('convert_error'))
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
        await this.resetSession(ctx)
      }
    },
  }

  public async onCommand(ctx: CustomContext): Promise<void> {
    await this.setSessionCommand(ctx)
    await ctx.reply(ctx.t('convert_send_file'))
  }
}
