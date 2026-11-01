import type { InputMediaDocument } from 'grammy/types'
import type { Buffer } from 'node:buffer'
import type { Metadata } from 'sharp'
import type { UserRepository } from '@/repositories/user.repository'
import type { WatermarkCorner, WatermarkParams, WatermarkProcessParams, WatermarkScale } from '@/schemas'
import type { CustomContext } from '@/types/custom-context.type'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { InlineKeyboard, InputFile } from 'grammy'
import sharp from 'sharp'
import { PHOTOS_PER_OPERATION_LIMITS, WATERMARK_MEDIA_GROUP_SIZE } from '@/config/constants'
import { CommandEnum } from '@/enums/command.enum'
import { PlanTypeEnum } from '@/enums/plan-type.enum'
import { InvalidFileError } from '@/errors/invalid-file.error'
import { InvalidWatermarkError } from '@/errors/invalid-watermark.error'
import { LimitExceededError } from '@/errors/limit-exceeded.error'
import { SessionValidationError } from '@/errors/session-validation.error'
import { UserNotFoundError } from '@/errors/user-not-found.error'
import { WatermarkConfiguredParamsSchema, WatermarkParamsSchema, WatermarkProcessParamsSchema } from '@/schemas'
import { chunk } from '@/utils/chunk.util'
import { formatString } from '@/utils/format.util'
import { BaseHandler } from './base.handler'

const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/tiff',
])

type OutputFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'tiff'

const SUPPORTED_OUTPUT_FORMATS = new Set<OutputFormat>(['jpeg', 'png', 'webp', 'avif', 'tiff'])

const OUTPUT_EXTENSIONS: Record<OutputFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  tiff: 'tiff',
}

const SCALE_RATIOS: Record<Exclude<WatermarkScale, 'auto'>, number> = {
  small: 0.10,
  medium: 0.20,
  large: 0.30,
}

const AUTO_SCALE_RATIO = 0.15
const MAX_HEIGHT_RATIO = 0.30
const MARGIN_RATIO = 0.025
const MIN_MARGIN = 8

const CORNERS: WatermarkCorner[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]

const CORNER_CALLBACKS: Record<string, WatermarkCorner> = {
  watermark_toggle_tl: 'top-left',
  watermark_toggle_tr: 'top-right',
  watermark_toggle_bl: 'bottom-left',
  watermark_toggle_br: 'bottom-right',
}

const SCALE_CALLBACKS: Record<string, WatermarkScale> = {
  watermark_scale_auto: 'auto',
  watermark_scale_small: 'small',
  watermark_scale_medium: 'medium',
  watermark_scale_large: 'large',
}

interface ProcessedPhoto {
  path: string
  name: string
}

interface ComposeOptions {
  inputPath: string
  metadata: Metadata
  format: OutputFormat
  markBuffer: Buffer
  markWidth: number
  markHeight: number
  positions: WatermarkCorner[]
  scale: WatermarkScale
}

export class WatermarkHandler extends BaseHandler {
  public readonly command = CommandEnum.Watermark
  public readonly description = '💧 Apply a watermark to multiple photos'
  public readonly chunkDelayMs = 1000

  constructor(private readonly userRepository: UserRepository) {
    super()
  }

  public readonly events = {
    'msg:photo': async (ctx: CustomContext) => {
      await this.safely(ctx, async () => {
        if (!ctx.user) {
          throw new UserNotFoundError()
        }

        const params = this.getParams(ctx)

        if (params.step === 'awaiting_watermark') {
          await ctx.reply(ctx.t('watermark_mark_as_file'))
          return
        }

        if (params.step !== 'collecting_bases') {
          return
        }

        const photo = ctx.message?.photo?.[ctx.message.photo.length - 1]
        if (!photo) {
          return
        }

        await this.collectBase(ctx, photo.file_id, photo.file_size)
      })
    },
    'msg:document': async (ctx: CustomContext) => {
      await this.safely(ctx, async () => {
        if (!ctx.user) {
          throw new UserNotFoundError()
        }

        const params = this.getParams(ctx)

        if (params.step === 'collecting_bases') {
          const document = ctx.message?.document
          if (!document) {
            return
          }

          if (!this.isSupportedMimeType(document.mime_type)) {
            await ctx.reply(ctx.t('watermark_unsupported_format'))
            return
          }

          await this.collectBase(ctx, document.file_id, document.file_size)
          return
        }

        if (params.step === 'awaiting_watermark') {
          await this.collectWatermark(ctx, params)
        }
      })
    },
    'msg:text': async (ctx: CustomContext) => {
      await this.safely(ctx, async () => {
        if (!ctx.user) {
          throw new UserNotFoundError()
        }

        const text = ctx.message?.text?.trim()
        if (!text) {
          return
        }

        if (ctx.me?.username && /^\/ready@/i.test(text)) {
          const match = text.match(/^\/ready@(\w+)$/i)
          if (!match || match[1].toLowerCase() !== ctx.me.username.toLowerCase()) {
            return
          }
        }
        else if (!/^\/ready$/i.test(text)) {
          return
        }

        const params = this.getParams(ctx)
        if (params.step !== 'collecting_bases') {
          return
        }

        await this.finishCollection(ctx, params, false)
      })
    },
    'callback_query': async (ctx: CustomContext) => {
      await this.safely(ctx, async () => {
        if (!ctx.user) {
          throw new UserNotFoundError()
        }

        const data = ctx.callbackQuery?.data
        if (!data) {
          return
        }

        if (data === 'watermark_ready') {
          await this.ready(ctx)
          return
        }

        if (data === 'watermark_cancel') {
          await this.handleCancel(ctx)
          return
        }

        const corner = CORNER_CALLBACKS[data]
        if (corner) {
          await this.toggleCorner(ctx, corner)
          return
        }

        if (data === 'watermark_apply') {
          await this.apply(ctx)
          return
        }

        if (data === 'watermark_back') {
          await this.back(ctx)
          return
        }

        const scale = SCALE_CALLBACKS[data]
        if (scale) {
          await this.process(ctx, scale)
        }
      })
    },
  }

  public async onCommand(ctx: CustomContext): Promise<void> {
    await this.setSessionCommand(ctx)

    const params = WatermarkParamsSchema.parse({
      step: 'collecting_bases',
      base_file_ids: [],
      positions: [],
      scale: 'auto',
    })

    ctx.session.params = params

    await ctx.reply(
      formatString(ctx.t('watermark_send_bases'), { limit: String(this.getPhotoLimit(ctx)) }),
    )
  }

  private async safely(ctx: CustomContext, action: () => Promise<void>): Promise<void> {
    try {
      await action()
    }
    catch (error) {
      if (error instanceof SessionValidationError) {
        throw error
      }

      if (error instanceof LimitExceededError) {
        return
      }

      if (error instanceof InvalidFileError || error instanceof InvalidWatermarkError) {
        await ctx.reply(ctx.t('watermark_invalid_file'))
        return
      }

      this.logger.error(error)
      await ctx.reply(ctx.t('watermark_error'))
    }
  }

  private getParams(ctx: CustomContext): WatermarkParams {
    const result = WatermarkParamsSchema.safeParse(ctx.session.params ?? {})

    if (!result.success) {
      this.logger.error({ error: result.error }, 'Session validation failed.')
      throw new SessionValidationError()
    }

    return result.data
  }

  private getPhotoLimit(ctx: CustomContext): number {
    const plan = ctx.user?.plan_type === PlanTypeEnum.Pro ? PlanTypeEnum.Pro : PlanTypeEnum.Free
    return PHOTOS_PER_OPERATION_LIMITS[plan]
  }

  private isCurrentKeyboard(ctx: CustomContext, params: WatermarkParams): boolean {
    const storedMessageId = params.callback_message_id
    if (!storedMessageId) {
      return false
    }

    return ctx.callbackQuery?.message?.message_id === storedMessageId
  }

  private isSupportedMimeType(mimeType?: string): boolean {
    return Boolean(mimeType && SUPPORTED_MIME_TYPES.has(mimeType))
  }

  private resolveOutputFormat(metadata: Metadata): OutputFormat | undefined {
    if (metadata.format === 'heif' && metadata.compression === 'av1') {
      return 'avif'
    }

    if (SUPPORTED_OUTPUT_FORMATS.has(metadata.format as OutputFormat)) {
      return metadata.format as OutputFormat
    }

    return undefined
  }

  private async validateWatermarkFile(filePath: string): Promise<Metadata> {
    let metadata: Metadata

    try {
      metadata = await this.validateImageFile(filePath)
    }
    catch {
      throw new InvalidWatermarkError()
    }

    if (!metadata.width || !metadata.height || !this.resolveOutputFormat(metadata)) {
      throw new InvalidWatermarkError()
    }

    return metadata
  }

  private readyKeyboard(ctx: CustomContext): InlineKeyboard {
    return new InlineKeyboard().text(ctx.t('watermark_ready_button'), 'watermark_ready')
  }

  private positionsKeyboard(ctx: CustomContext, positions: WatermarkCorner[]): InlineKeyboard {
    const selected = new Set(positions)
    const label = (corner: WatermarkCorner) => selected.has(corner) ? '✅' : '⬜'

    return new InlineKeyboard()
      .text(`${label('top-left')} ${ctx.t('watermark_position_top_left')}`, 'watermark_toggle_tl')
      .text(`${label('top-right')} ${ctx.t('watermark_position_top_right')}`, 'watermark_toggle_tr')
      .row()
      .text(`${label('bottom-left')} ${ctx.t('watermark_position_bottom_left')}`, 'watermark_toggle_bl')
      .text(`${label('bottom-right')} ${ctx.t('watermark_position_bottom_right')}`, 'watermark_toggle_br')
      .row()
      .text(ctx.t('watermark_apply'), 'watermark_apply')
      .row()
      .text(ctx.t('watermark_cancel'), 'watermark_cancel')
  }

  private scaleKeyboard(ctx: CustomContext): InlineKeyboard {
    return new InlineKeyboard()
      .text(ctx.t('watermark_scale_auto'), 'watermark_scale_auto')
      .text(ctx.t('watermark_scale_small'), 'watermark_scale_small')
      .row()
      .text(ctx.t('watermark_scale_medium'), 'watermark_scale_medium')
      .text(ctx.t('watermark_scale_large'), 'watermark_scale_large')
      .row()
      .text(ctx.t('watermark_back'), 'watermark_back')
      .text(ctx.t('watermark_cancel'), 'watermark_cancel')
  }

  private async collectBase(ctx: CustomContext, fileId: string, fileSize?: number): Promise<void> {
    await this.checkLimits(ctx, { fileSize })

    const params = this.getParams(ctx)
    const limit = this.getPhotoLimit(ctx)

    if (params.base_file_ids.length >= limit) {
      if (!params.limit_warned) {
        params.limit_warned = true
        ctx.session.params = params
        await ctx.reply(this.photoLimitMessage(ctx, limit), {
          reply_markup: this.readyKeyboard(ctx),
        })
      }
      return
    }

    params.base_file_ids.push(fileId)
    ctx.session.params = params

    if (params.base_file_ids.length === 1) {
      await ctx.reply(ctx.t('watermark_bases_hint'), {
        reply_markup: this.readyKeyboard(ctx),
      })
      return
    }

    if (params.base_file_ids.length === limit) {
      params.limit_warned = true
      ctx.session.params = params
      await ctx.reply(this.photoLimitMessage(ctx, limit), {
        reply_markup: this.readyKeyboard(ctx),
      })
    }
  }

  private photoLimitMessage(ctx: CustomContext, limit: number): string {
    const isPro = ctx.user?.plan_type === PlanTypeEnum.Pro
    const key = isPro
      ? 'watermark_photo_limit_reached_pro'
      : 'watermark_photo_limit_reached_free'

    return formatString(ctx.t(key), { limit: String(limit) })
  }

  private async ready(ctx: CustomContext): Promise<void> {
    const params = this.getParams(ctx)

    if (params.step !== 'collecting_bases') {
      await ctx.answerCallbackQuery()
      return
    }

    await this.finishCollection(ctx, params, true)
  }

  private async finishCollection(
    ctx: CustomContext,
    params: WatermarkParams,
    fromCallback: boolean,
  ): Promise<void> {
    const limit = this.getPhotoLimit(ctx)

    if (params.base_file_ids.length === 0) {
      if (fromCallback) {
        await ctx.answerCallbackQuery({
          text: ctx.t('watermark_ready_alert'),
          show_alert: true,
        })
      }
      else {
        await ctx.reply(
          formatString(ctx.t('watermark_send_bases'), { limit: String(limit) }),
        )
      }
      return
    }

    ctx.session.params = {
      ...params,
      base_file_ids: params.base_file_ids.slice(0, limit),
      step: 'awaiting_watermark',
    }

    if (fromCallback) {
      await ctx.answerCallbackQuery()
      await ctx.editMessageText(ctx.t('watermark_send_mark'))
      return
    }

    await ctx.reply(ctx.t('watermark_send_mark'))
  }

  private async collectWatermark(ctx: CustomContext, params: WatermarkParams): Promise<void> {
    const document = ctx.message?.document
    if (!document) {
      return
    }

    if (!this.isSupportedMimeType(document.mime_type)) {
      await ctx.reply(ctx.t('watermark_unsupported_format'))
      return
    }

    await this.checkLimits(ctx, { fileSize: document.file_size })

    let watermarkPath: string | undefined

    try {
      const file = await ctx.api.getFile(document.file_id)
      watermarkPath = await file.download()

      if (!watermarkPath) {
        throw new Error('Failed to download watermark file')
      }

      const { size } = await fs.stat(watermarkPath)
      await this.checkLimits(ctx, { fileSize: size })

      const metadata = await this.validateWatermarkFile(watermarkPath)

      const configured = this.validateParams(WatermarkConfiguredParamsSchema, {
        ...params,
        base_file_ids: params.base_file_ids.slice(0, this.getPhotoLimit(ctx)),
        watermark_file_id: document.file_id,
      })

      const text = metadata.hasAlpha
        ? ctx.t('watermark_choose_positions')
        : `${ctx.t('watermark_choose_positions')}\n\n${ctx.t('watermark_no_transparency')}`

      const reply = await ctx.reply(text, {
        reply_markup: this.positionsKeyboard(ctx, []),
      })

      ctx.session.params = {
        ...configured,
        step: 'positions',
        positions: [],
        callback_message_id: reply.message_id,
      }
    }
    finally {
      if (watermarkPath) {
        await fs.rm(watermarkPath, { force: true }).catch(error =>
          this.logger.error({ error, path: watermarkPath }, 'Failed to remove watermark file.'),
        )
      }
    }
  }

  private async toggleCorner(ctx: CustomContext, corner: WatermarkCorner): Promise<void> {
    const sessionParams = this.getParams(ctx)

    if (sessionParams.step !== 'positions' || !this.isCurrentKeyboard(ctx, sessionParams)) {
      await ctx.answerCallbackQuery()
      return
    }

    const params = this.validateParams(WatermarkConfiguredParamsSchema, sessionParams)
    const selected = new Set(params.positions)

    if (selected.has(corner)) {
      selected.delete(corner)
    }
    else {
      selected.add(corner)
    }

    const positions = CORNERS.filter(c => selected.has(c))

    ctx.session.params = { ...params, positions }

    await ctx.answerCallbackQuery()
    await ctx.editMessageReplyMarkup({
      reply_markup: this.positionsKeyboard(ctx, positions),
    })
  }

  private async apply(ctx: CustomContext): Promise<void> {
    const sessionParams = this.getParams(ctx)

    if (sessionParams.step !== 'positions' || !this.isCurrentKeyboard(ctx, sessionParams)) {
      await ctx.answerCallbackQuery()
      return
    }

    const params = this.validateParams(WatermarkConfiguredParamsSchema, sessionParams)

    if (params.positions.length === 0) {
      await ctx.answerCallbackQuery({
        text: ctx.t('watermark_select_at_least_one'),
        show_alert: true,
      })
      return
    }

    ctx.session.params = { ...params, step: 'scale' }

    await ctx.answerCallbackQuery()
    await ctx.editMessageText(ctx.t('watermark_choose_scale'), {
      reply_markup: this.scaleKeyboard(ctx),
    })
  }

  private async back(ctx: CustomContext): Promise<void> {
    const sessionParams = this.getParams(ctx)

    if (sessionParams.step !== 'scale' || !this.isCurrentKeyboard(ctx, sessionParams)) {
      await ctx.answerCallbackQuery()
      return
    }

    const params = this.validateParams(WatermarkConfiguredParamsSchema, sessionParams)

    ctx.session.params = { ...params, step: 'positions' }

    await ctx.answerCallbackQuery()
    await ctx.editMessageText(ctx.t('watermark_choose_positions'), {
      reply_markup: this.positionsKeyboard(ctx, params.positions),
    })
  }

  private async handleCancel(ctx: CustomContext): Promise<void> {
    const params = this.getParams(ctx)

    if (params.step !== 'positions' && params.step !== 'scale') {
      await ctx.answerCallbackQuery()
      return
    }

    const storedMessageId = params.callback_message_id as number | undefined
    if (!storedMessageId || ctx.callbackQuery?.message?.message_id !== storedMessageId) {
      await ctx.answerCallbackQuery()
      return
    }

    await ctx.answerCallbackQuery()
    await this.resetSession(ctx)

    await ctx.editMessageText(ctx.t('watermark_cancelled')).catch(error =>
      this.logger.error({ error }, 'Failed to edit cancelled watermark message.'),
    )
  }

  private async process(ctx: CustomContext, scale: WatermarkScale): Promise<void> {
    const sessionParams = this.getParams(ctx)

    if (sessionParams.step !== 'scale' || !this.isCurrentKeyboard(ctx, sessionParams)) {
      await ctx.answerCallbackQuery()
      return
    }

    const validated = this.validateParams(WatermarkProcessParamsSchema, sessionParams)
    const params = {
      ...validated,
      base_file_ids: validated.base_file_ids.slice(0, this.getPhotoLimit(ctx)),
      scale,
    }

    ctx.session.params = { ...params, step: 'scale' }

    await ctx.answerCallbackQuery()
    await this.editProgress(
      ctx,
      formatString(ctx.t('watermark_processing'), { total: String(params.base_file_ids.length) }),
    )

    await this.processBatch(ctx, params)
  }

  private async processBatch(ctx: CustomContext, params: WatermarkProcessParams): Promise<void> {
    const temporaryPaths = new Set<string>()

    try {
      await this.runWithUsage(ctx, this.userRepository, async (markDelivered) => {
        const watermarkFile = await ctx.api.getFile(params.watermark_file_id)
        const watermarkPath = await watermarkFile.download()

        if (!watermarkPath) {
          throw new Error('Failed to download watermark file')
        }

        temporaryPaths.add(watermarkPath)

        const markMetadata = await this.validateWatermarkFile(watermarkPath)

        const markBuffer = await fs.readFile(watermarkPath)
        const markWidth = markMetadata.autoOrient?.width ?? markMetadata.width
        const markHeight = markMetadata.autoOrient?.height ?? markMetadata.height

        const chunks = chunk(params.base_file_ids, WATERMARK_MEDIA_GROUP_SIZE)
        const total = params.base_file_ids.length

        let success = 0
        let failed = 0
        let processed = 0
        let delivered = false

        for (const [chunkIndex, fileIds] of chunks.entries()) {
          const outputs: ProcessedPhoto[] = []

          for (const fileId of fileIds) {
            processed += 1

            try {
              const output = await this.processPhoto({
                ctx,
                fileId,
                markBuffer,
                markWidth,
                markHeight,
                positions: params.positions,
                scale: params.scale,
                index: processed,
              })

              outputs.push(output)
              temporaryPaths.add(output.path)
              success += 1
            }
            catch (error) {
              failed += 1
              this.logger.error({ error, fileId }, 'Failed to apply watermark to photo.')
            }
          }

          if (outputs.length > 0) {
            await this.sendResults(ctx, outputs, chunkIndex + 1, chunks.length)

            if (!delivered) {
              markDelivered()
              delivered = true
            }
          }

          await Promise.all(
            outputs.map(output =>
              fs.rm(output.path, { force: true }).catch(error =>
                this.logger.error({ error, path: output.path }, 'Failed to remove output file.'),
              ),
            ),
          )

          await this.editProgress(
            ctx,
            formatString(ctx.t('watermark_progress'), {
              done: String(processed),
              total: String(total),
            }),
          )

          if (chunkIndex < chunks.length - 1 && this.chunkDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, this.chunkDelayMs))
          }
        }

        if (success === 0) {
          throw new InvalidFileError()
        }

        if (failed > 0) {
          await ctx.reply(
            formatString(ctx.t('watermark_batch_summary_failures'), {
              success: String(success),
              total: String(total),
              failed: String(failed),
            }),
          )
        }

        await this.editProgress(
          ctx,
          formatString(ctx.t('watermark_batch_summary'), {
            success: String(success),
            total: String(total),
          }),
        )
      })
    }
    catch (error) {
      if (error instanceof InvalidWatermarkError) {
        await ctx.reply(ctx.t('watermark_invalid_file'))
        return
      }

      if (error instanceof InvalidFileError) {
        await ctx.reply(ctx.t('watermark_no_valid_photos'))
        return
      }

      if (error instanceof LimitExceededError) {
        return
      }

      this.logger.error(error)
      await ctx.reply(ctx.t('watermark_error'))
    }
    finally {
      await Promise.all(
        [...temporaryPaths].map(path =>
          fs.rm(path, { force: true }).catch(error =>
            this.logger.error({ error, path }, 'Failed to remove temporary file.'),
          ),
        ),
      )

      await this.resetSession(ctx)
    }
  }

  private async processPhoto(options: {
    ctx: CustomContext
    fileId: string
    markBuffer: Buffer
    markWidth: number
    markHeight: number
    positions: WatermarkCorner[]
    scale: WatermarkScale
    index: number
  }): Promise<ProcessedPhoto> {
    const { ctx, fileId, markBuffer, markWidth, markHeight, positions, scale, index } = options
    let inputPath: string | undefined

    try {
      const file = await ctx.api.getFile(fileId)
      inputPath = await file.download()

      if (!inputPath) {
        throw new Error('Failed to download photo')
      }

      const { size } = await fs.stat(inputPath)
      await this.checkLimits(ctx, { fileSize: size })

      const metadata = await this.validateImageFile(inputPath)

      if (!metadata.width || !metadata.height) {
        throw new InvalidFileError()
      }

      const format = this.resolveOutputFormat(metadata)

      if (!format) {
        throw new InvalidFileError()
      }

      const buffer = await this.composeWatermark({
        inputPath,
        metadata,
        format,
        markBuffer,
        markWidth,
        markHeight,
        positions,
        scale,
      })

      const extension = OUTPUT_EXTENSIONS[format]
      const outputPath = join(os.tmpdir(), `watermark-${crypto.randomUUID()}.${extension}`)

      try {
        await fs.writeFile(outputPath, buffer)
      }
      catch (writeError) {
        await fs.rm(outputPath, { force: true }).catch(() => {})
        throw writeError
      }

      return {
        path: outputPath,
        name: `watermarked-${index}.${extension}`,
      }
    }
    finally {
      if (inputPath) {
        await fs.rm(inputPath, { force: true }).catch(error =>
          this.logger.error({ error, path: inputPath }, 'Failed to remove input file.'),
        )
      }
    }
  }

  private async composeWatermark(options: ComposeOptions): Promise<Buffer> {
    const { inputPath, metadata, format, markBuffer, markWidth, markHeight, positions, scale } = options

    const baseWidth = metadata.autoOrient?.width ?? metadata.width
    const baseHeight = metadata.autoOrient?.height ?? metadata.height

    const ratio = scale === 'auto' ? AUTO_SCALE_RATIO : SCALE_RATIOS[scale]
    const maxByHeight = Math.floor((baseHeight * MAX_HEIGHT_RATIO) * (markWidth / markHeight))

    if (maxByHeight < 1) {
      throw new InvalidWatermarkError()
    }

    const targetWidth = Math.max(
      1,
      Math.min(Math.round(baseWidth * ratio), maxByHeight, markWidth),
    )
    const targetHeight = Math.max(1, Math.round((markHeight * targetWidth) / markWidth))

    const margin = Math.max(
      0,
      Math.min(
        Math.max(MIN_MARGIN, Math.round(Math.min(baseWidth, baseHeight) * MARGIN_RATIO)),
        Math.floor((baseWidth - targetWidth) / 2),
        Math.floor((baseHeight - targetHeight) / 2),
      ),
    )

    const resizedMark = await sharp(markBuffer)
      .autoOrient()
      .resize(targetWidth, targetHeight, { fit: 'fill' })
      .toBuffer()

    const composites = positions.map((position) => {
      const isRight = position.endsWith('right')
      const isBottom = position.startsWith('bottom')

      return {
        input: resizedMark,
        left: isRight ? baseWidth - targetWidth - margin : margin,
        top: isBottom ? baseHeight - targetHeight - margin : margin,
      }
    })

    const formatOptions = format === 'jpeg' || format === 'webp' || format === 'avif'
      ? { quality: 90 }
      : undefined

    return sharp(inputPath)
      .autoOrient()
      .composite(composites)
      .toFormat(format, formatOptions)
      .toBuffer()
  }

  private async sendResults(
    ctx: CustomContext,
    results: ProcessedPhoto[],
    chunkIndex: number,
    chunks: number,
  ): Promise<void> {
    if (results.length === 1) {
      const result = results[0]
      const caption = chunks > 1
        ? this.batchCaption(ctx, chunkIndex, chunks)
        : ctx.t('watermark_success')

      await ctx.replyWithDocument(
        new InputFile(result.path, result.name),
        { caption },
      )
      return
    }

    const media: InputMediaDocument[] = results.map((result, index) => ({
      type: 'document',
      media: new InputFile(result.path, result.name),
      ...(index === 0
        ? {
            caption: this.batchCaption(ctx, chunkIndex, chunks),
          }
        : {}),
    }))

    await ctx.replyWithMediaGroup(media)
  }

  private batchCaption(ctx: CustomContext, chunkIndex: number, chunks: number): string {
    return formatString(ctx.t('watermark_batch_chunk'), {
      chunk: String(chunkIndex),
      chunks: String(chunks),
    })
  }

  private async editProgress(ctx: CustomContext, text: string): Promise<void> {
    await ctx.editMessageText(text).catch(error =>
      this.logger.error({ error }, 'Failed to update watermark progress.'),
    )
  }
}
