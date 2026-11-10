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
import { RotateParamsSchema } from '@/schemas'
import { BaseHandler } from './base.handler'

export class RotateHandler extends BaseHandler {
  constructor(private readonly userRepository: UserRepository) {
    super()
  }

  readonly command = CommandEnum.Rotate
  readonly description = '🔄 Rotate an image'
  readonly events = {
    'msg:photo': async (ctx: CustomContext) => {
      try {
        if (!ctx.user) {
          throw new UserNotFoundError()
        }

        if (!ctx.message?.photo)
          return
        const photo = ctx.message.photo[ctx.message.photo.length - 1]
        const documentId = photo.file_id
        if (!documentId)
          return

        ctx.session.params = {
          file_id: documentId,
        }

        const keyboard = new InlineKeyboard()
          .text('90°', 'rotate_90')
          .text('180°', 'rotate_180')
          .text('-90°', 'rotate_-90')

        await ctx.reply(ctx.t('rotate_choose_degrees'), {
          reply_markup: keyboard,
        })
      }
      catch (error) {
        if (error instanceof InvalidFileError || error instanceof LimitExceededError) {
          return
        }

        this.logger.error(error)
        await ctx.reply(ctx.t('rotate_error'))
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
        if (!data?.startsWith('rotate_'))
          return

        const [, degreesStr] = data.split('_')
        if (!degreesStr)
          return
        const degreesValue = Number(degreesStr)

        if (![90, 180, -90].includes(degreesValue))
          return

        await ctx.answerCallbackQuery()

        const { file_id: fileId } = this.validateParams(RotateParamsSchema, ctx.session.params)

        // We edit the message to remove keyboard
        await ctx.editMessageText(ctx.t('rotate_rotating'))

        const file = await ctx.api.getFile(fileId)

        const fileSize = file.file_size ?? 0
        await this.checkLimits(ctx, { fileSize })

        await this.runWithUsage(ctx, this.userRepository, async () => {
          inputPath = await file.download()

          if (!inputPath) {
            throw new Error('Failed to download file')
          }

          await this.validateImageFile(inputPath)

          const buffer = await sharp(inputPath)
            .rotate(degreesValue)
            .toBuffer()

          outputPath = join(os.tmpdir(), `rotate-${crypto.randomUUID()}.jpg`)
          await fs.writeFile(outputPath, buffer)

          const rotatedFile = new InputFile(outputPath, 'rotated.jpg')
          await ctx.replyWithPhoto(rotatedFile, {
            caption: ctx.t('rotate_success'),
          })
        })
      }
      catch (error) {
        if (error instanceof LimitExceededError) {
          return
        }

        this.logger.error(error)
        await ctx.reply(ctx.t('rotate_error'))
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

  async onCommand(ctx: CustomContext): Promise<void> {
    await this.setSessionCommand(ctx)
    await ctx.reply(ctx.t('rotate_send_file'))
  }
}
