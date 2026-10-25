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
import { ResizeParamsSchema } from '@/schemas'
import { BaseHandler } from './base.handler'

export class ResizeHandler extends BaseHandler {
  public readonly command = CommandEnum.Resize
  public readonly description = '📐 Resize an image'

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
          .text('256x256', 'resize_256_256')
          .text('512x512', 'resize_512_512')
          .text('1024x1024', 'resize_1024_1024')
          .text('✏️ Custom', 'resize_custom')

        await ctx.reply(ctx.t('resize_choose_size'), {
          reply_markup: keyboard,
        })
      }
      catch (error) {
        if (error instanceof InvalidFileError || error instanceof LimitExceededError) {
          return
        }

        this.logger.error(error)
        await ctx.reply(ctx.t('resize_error'))
      }
    },
    'callback_query': async (ctx: CustomContext) => {
      let inputPath: string | undefined
      let outputPath: string | undefined
      let shouldResetSession = true

      try {
        if (!ctx.user) {
          throw new UserNotFoundError()
        }

        const data = ctx.callbackQuery?.data

        if (data === 'resize_custom') {
          await ctx.answerCallbackQuery()
          await ctx.reply(ctx.t('resize_custom_dimensions'))
          shouldResetSession = false
          return
        }

        if (!data?.startsWith('resize_'))
          return

        const [, widthStr, heightStr] = data.split('_')
        if (!widthStr || !heightStr)
          return
        const width = Number(widthStr)
        const height = Number(heightStr)

        if (![256, 512, 1024].includes(width) || ![256, 512, 1024].includes(height))
          return

        await ctx.answerCallbackQuery()

        const { file_id: fileId } = this.validateParams(ResizeParamsSchema, ctx.session.params)

        await ctx.editMessageText(ctx.t('resize_resizing'))

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
            .resize(width, height)
            .toBuffer()

          outputPath = join(os.tmpdir(), `resize-${crypto.randomUUID()}.jpg`)
          await fs.writeFile(outputPath, buffer)

          const resizedFile = new InputFile(outputPath, 'resized.jpg')
          await ctx.replyWithPhoto(resizedFile, {
            caption: ctx.t('resize_success'),
          })
        })
      }
      catch (error) {
        if (error instanceof LimitExceededError) {
          return
        }

        this.logger.error(error)
        await ctx.reply(ctx.t('resize_error'))
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
          await ctx.reply(ctx.t('resize_invalid_dimensions'))
          return
        }

        const width = Number(match[1])
        const height = Number(match[2])

        if (width <= 0 || height <= 0 || width > 4096 || height > 4096) {
          await ctx.reply(ctx.t('resize_invalid_dimensions'))
          return
        }

        shouldResetSession = true

        const { file_id: fileId } = this.validateParams(ResizeParamsSchema, ctx.session.params)

        await ctx.reply(ctx.t('resize_resizing'))

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

          const buffer = await sharp(inputPath)
            .resize(width, height)
            .toBuffer()

          outputPath = join(os.tmpdir(), `resize-${crypto.randomUUID()}.jpg`)
          await fs.writeFile(outputPath, buffer)

          const resizedFile = new InputFile(outputPath, 'resized.jpg')
          await ctx.replyWithPhoto(resizedFile, {
            caption: ctx.t('resize_success'),
          })
        })
      }
      catch (error) {
        if (error instanceof LimitExceededError) {
          return
        }

        if (error instanceof InvalidFileError) {
          await ctx.reply(ctx.t('resize_invalid_file'))
          return
        }

        this.logger.error(error)
        await ctx.reply(ctx.t('resize_error'))
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
    await ctx.reply(ctx.t('resize_send_file'))
  }
}
