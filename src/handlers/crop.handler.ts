import type { UserRepository } from '../repositories/user.repository'
import type { CustomContext } from '../types/custom-context.type'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { InlineKeyboard, InputFile } from 'grammy'
import sharp from 'sharp'
import { CommandEnum } from '../enums/command.enum'
import { InvalidFileError } from '../errors/invalid-file.error'
import { LimitExceededError } from '../errors/limit-exceeded.error'
import { UserNotFoundError } from '../errors/user-not-found.error'
import { CropParamsSchema } from '../schemas'
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
  }

  public async onCommand(ctx: CustomContext): Promise<void> {
    await this.setSessionCommand(ctx)
    await ctx.reply(ctx.t('crop_send_file'))
  }
}
