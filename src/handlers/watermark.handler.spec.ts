import type { UserRepository } from '@/repositories/user.repository'
import type { WatermarkParams } from '@/schemas'
import type { CustomContext } from '@/types/custom-context.type'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import { InlineKeyboard } from 'grammy'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandEnum } from '@/enums/command.enum'
import { PlanTypeEnum } from '@/enums/plan-type.enum'
import { LimitExceededError } from '@/errors/limit-exceeded.error'
import { WatermarkHandler } from './watermark.handler'

vi.mock('node:fs/promises', () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('mark data')),
    stat: vi.fn().mockResolvedValue({ size: 100 }),
  },
}))

vi.mock('node:os', () => ({
  default: {
    tmpdir: vi.fn().mockReturnValue('/tmp'),
  },
}))

vi.mock('sharp', () => {
  const metadata = new Map<unknown, unknown>()

  const sharpMock: any = vi.fn((input: unknown) => {
    const instance: any = {
      metadata: vi.fn(async () => {
        const value = metadata.get(input)

        if (value instanceof Error) {
          throw value
        }

        return value ?? {
          width: 1000,
          height: 800,
          format: 'jpeg',
          hasAlpha: false,
          autoOrient: { width: 1000, height: 800 },
        }
      }),
      autoOrient: vi.fn(() => instance),
      resize: vi.fn(() => instance),
      composite: vi.fn(() => instance),
      toFormat: vi.fn(() => instance),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('output')),
    }

    return instance
  })

  sharpMock.__metadata = metadata

  return { default: sharpMock }
})

vi.mock('grammy', async () => {
  const actual = await vi.importActual<typeof import('grammy')>('grammy')
  return {
    ...actual,
    InputFile: class {
      constructor(public path: string, public name: string) {}
    },
  }
})

const translations: Record<string, string> = {
  watermark_send_bases: 'Send up to {limit}',
  watermark_photo_limit_reached_free: 'Limit {limit} free',
  watermark_photo_limit_reached_pro: 'Limit {limit} pro',
  watermark_processing: 'Processing {total}',
  watermark_progress: 'Progress {done}/{total}',
  watermark_batch_chunk: 'Batch {chunk}/{chunks}',
  watermark_batch_summary: 'Summary {success}/{total}',
  watermark_batch_summary_failures: 'Failures failed={failed} success={success} total={total}',
}

describe(WatermarkHandler.name, () => {
  let userRepository: UserRepository
  let handler: WatermarkHandler
  let ctx: CustomContext
  let downloads: Map<string, string>
  let getFileImpl: (fileId: string) => Promise<any>

  const t = (key: string) => translations[key] ?? key
  const metadata = () => (sharp as any).__metadata as Map<string, any>

  function setParams(partial: Partial<WatermarkParams> = {}) {
    ctx.session.params = {
      step: 'collecting_bases',
      base_file_ids: [],
      positions: [],
      scale: 'auto',
      ...partial,
    }
  }

  function params(): WatermarkParams {
    return ctx.session.params as WatermarkParams
  }

  function setPhoto(fileId = 'photo-1', fileSize = 100) {
    ;(ctx as any).message = {
      photo: [{ file_id: fileId, file_size: fileSize }],
    } as any
  }

  function setDocument(fileId = 'document-1', mimeType = 'image/png', fileSize = 100) {
    ;(ctx as any).message = {
      document: { file_id: fileId, mime_type: mimeType, file_size: fileSize },
    } as any
  }

  function setText(text: string) {
    ;(ctx as any).message = { text } as any
  }

  function setCallback(data: string, messageId?: number) {
    ;(ctx as any).callbackQuery = {
      data,
      ...(messageId !== undefined ? { message: { message_id: messageId } } : {}),
    } as any
  }

  function setBaseMetadata(fileId: string, options: {
    format?: string
    compression?: string
    width?: number
    height?: number
  } = {}) {
    const format = options.format ?? 'jpeg'
    const extension = format === 'jpeg' ? 'jpg' : format === 'heif' ? 'avif' : format
    const path = `/tmp/${fileId}.${extension}`
    const width = options.width ?? 1000
    const height = options.height ?? 800

    downloads.set(fileId, path)
    metadata().set(path, {
      width,
      height,
      format,
      compression: options.compression,
      hasAlpha: false,
      autoOrient: { width, height },
    })

    return path
  }

  function prepareConfigured(partial: Partial<WatermarkParams> = {}) {
    setParams({
      step: 'positions',
      base_file_ids: ['base-1'],
      watermark_file_id: 'mark',
      positions: [],
      scale: 'auto',
      callback_message_id: 100,
      ...partial,
    })
    downloads.set('mark', '/tmp/mark.png')
    metadata().set('/tmp/mark.png', {
      width: 1000,
      height: 500,
      format: 'png',
      hasAlpha: true,
      autoOrient: { width: 1000, height: 500 },
    })
  }

  function prepareProcessing(
    files: Array<{ id: string, format?: string, compression?: string, width?: number, height?: number }>,
    partial: Partial<WatermarkParams> = {},
  ) {
    prepareConfigured({
      step: 'scale',
      base_file_ids: files.map(file => file.id),
      positions: ['top-left'],
      scale: 'medium',
      ...partial,
    })

    for (const file of files) {
      setBaseMetadata(file.id, file)
    }
  }

  function replyKeyboard(callIndex = 0): InlineKeyboard {
    const call = vi.mocked(ctx.reply).mock.calls[callIndex]
    return (call[1] as any).reply_markup as InlineKeyboard
  }

  function sentMedia(): any[] {
    return vi.mocked(ctx.replyWithMediaGroup).mock.calls[0][0] as any[]
  }

  beforeEach(() => {
    vi.clearAllMocks()
    metadata().clear()
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('mark data'))

    downloads = new Map()
    getFileImpl = async fileId => ({
      file_id: fileId,
      file_size: 100,
      download: vi.fn().mockResolvedValue(downloads.get(fileId) ?? `/tmp/${fileId}`),
    })

    userRepository = {
      incrementUsage: vi.fn().mockResolvedValue({ id: 1 }),
      decrementUsage: vi.fn().mockResolvedValue({ id: 1 }),
    } as unknown as UserRepository

    handler = new WatermarkHandler(userRepository)
    // @ts-expect-error logger is protected
    handler.logger = { error: vi.fn() }
    ;(handler as any).chunkDelayMs = 0

    ctx = {
      session: {
        command: CommandEnum.Watermark,
        params: null,
      },
      t,
      user: { plan_type: PlanTypeEnum.Free },
      from: { id: 1 },
      me: { username: 'picture_studio_bot' },
      reply: vi.fn().mockResolvedValue({ message_id: 100 }),
      editMessageText: vi.fn().mockResolvedValue(undefined),
      editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      replyWithDocument: vi.fn().mockResolvedValue(undefined),
      replyWithMediaGroup: vi.fn().mockResolvedValue(undefined),
      api: {
        getFile: vi.fn((fileId: string) => getFileImpl(fileId)),
      },
      message: {},
      callbackQuery: {},
    } as unknown as CustomContext

    setParams()
  })

  it('should match command and description', () => {
    expect(handler.command).toBe(CommandEnum.Watermark)
    expect(handler.description).toBe('💧 Apply a watermark to multiple photos')
  })

  it('should not define a generic message event', () => {
    expect(handler.events).not.toHaveProperty('message')
  })

  describe(WatermarkHandler.prototype.onCommand.name, () => {
    it('should initialize the session and ask for photos', async () => {
      ctx.session.command = null
      ctx.session.params = null

      await handler.onCommand(ctx)

      expect(ctx.session.command).toBe(CommandEnum.Watermark)
      expect(params()).toEqual({
        step: 'collecting_bases',
        base_file_ids: [],
        positions: [],
        scale: 'auto',
      })
      expect(ctx.reply).toHaveBeenCalledWith('Send up to 3')
    })

    it('should use the pro limit for pro users', async () => {
      ctx.user = { plan_type: PlanTypeEnum.Pro } as any

      await handler.onCommand(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('Send up to 100')
    })
  })

  describe('msg:photo', () => {
    it('should collect the first photo and show the ready button', async () => {
      setPhoto('photo-1')

      await handler.events['msg:photo']!(ctx)

      expect(params().base_file_ids).toEqual(['photo-1'])
      expect(params().step).toBe('collecting_bases')
      expect(ctx.reply).toHaveBeenCalledWith('watermark_bases_hint', {
        reply_markup: expect.any(InlineKeyboard),
      })

      const keyboard = replyKeyboard()
      expect(keyboard.inline_keyboard[0][0].text).toBe('watermark_ready_button')
      expect((keyboard.inline_keyboard[0][0] as any).callback_data).toBe('watermark_ready')
    })

    it('should collect up to the free limit and notify when it is reached', async () => {
      for (let index = 1; index <= 3; index++) {
        setPhoto(`photo-${index}`)
        await handler.events['msg:photo']!(ctx)
      }

      expect(params().base_file_ids).toEqual(['photo-1', 'photo-2', 'photo-3'])
      expect(ctx.reply).toHaveBeenLastCalledWith('Limit 3 free', {
        reply_markup: expect.any(InlineKeyboard),
      })
    })

    it('should warn once and ignore photos beyond the free limit', async () => {
      for (let index = 1; index <= 4; index++) {
        setPhoto(`photo-${index}`)
        await handler.events['msg:photo']!(ctx)
      }

      expect(params().base_file_ids).toEqual(['photo-1', 'photo-2', 'photo-3'])
      expect(params().limit_warned).toBe(true)
      expect(ctx.reply).toHaveBeenCalledTimes(2)

      setPhoto('photo-5')
      await handler.events['msg:photo']!(ctx)

      expect(ctx.reply).toHaveBeenCalledTimes(2)
      expect(params().base_file_ids).toEqual(['photo-1', 'photo-2', 'photo-3'])
    })

    it('should collect ten photos for pro users without warning', async () => {
      ctx.user = { plan_type: PlanTypeEnum.Pro } as any

      for (let index = 1; index <= 10; index++) {
        setPhoto(`photo-${index}`)
        await handler.events['msg:photo']!(ctx)
      }

      expect(params().base_file_ids).toHaveLength(10)
      expect(ctx.reply).toHaveBeenCalledTimes(1)
      expect(ctx.reply).toHaveBeenCalledWith('watermark_bases_hint', {
        reply_markup: expect.any(InlineKeyboard),
      })
    })

    it('should cap pro users at one hundred photos and warn once', async () => {
      ctx.user = { plan_type: PlanTypeEnum.Pro } as any

      for (let index = 1; index <= 101; index++) {
        setPhoto(`photo-${index}`)
        await handler.events['msg:photo']!(ctx)
      }

      expect(params().base_file_ids).toHaveLength(100)
      expect(params().limit_warned).toBe(true)
      expect(ctx.reply).toHaveBeenCalledTimes(2)
    })

    it('should ask for the watermark file when a photo arrives at that step', async () => {
      setParams({ step: 'awaiting_watermark', base_file_ids: ['photo-1'] })
      setPhoto('photo-2')

      await handler.events['msg:photo']!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('watermark_mark_as_file')
      expect(params().base_file_ids).toEqual(['photo-1'])
    })

    it('should ignore photos during later steps', async () => {
      prepareConfigured()

      setPhoto('photo-2')
      await handler.events['msg:photo']!(ctx)

      expect(ctx.reply).not.toHaveBeenCalled()
    })

    it('should silence file size limit errors', async () => {
      vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new LimitExceededError())
      setPhoto('photo-1')

      await handler.events['msg:photo']!(ctx)

      expect(params().base_file_ids).toEqual([])
      expect(ctx.reply).not.toHaveBeenCalled()
    })

    it('should reply with a generic error for unexpected failures', async () => {
      vi.spyOn(handler as any, 'getParams').mockImplementationOnce(() => {
        throw new Error('unexpected')
      })
      setPhoto('photo-1')

      await handler.events['msg:photo']!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('watermark_error')
      expect((handler as any).logger.error).toHaveBeenCalled()
    })
  })

  describe('msg:document', () => {
    it('should collect a supported document', async () => {
      setDocument('document-1', 'image/png')

      await handler.events['msg:document']!(ctx)

      expect(params().base_file_ids).toEqual(['document-1'])
      expect(ctx.reply).toHaveBeenCalledWith('watermark_bases_hint', {
        reply_markup: expect.any(InlineKeyboard),
      })
    })

    it.each(['image/gif', 'image/svg+xml', 'image/heic', 'application/pdf', 'missing'])(
      'should reject unsupported mime type %s without collecting it',
      async (mimeType) => {
        if (mimeType === 'missing') {
          ;(ctx as any).message = {
            document: { file_id: 'document-1', file_size: 100 },
          } as any
        }
        else {
          setDocument('document-1', mimeType)
        }

        await handler.events['msg:document']!(ctx)

        expect(params().base_file_ids).toEqual([])
        expect(ctx.reply).toHaveBeenCalledWith('watermark_unsupported_format')
      },
    )

    it('should ignore documents during later steps', async () => {
      prepareConfigured()

      setDocument('document-1', 'image/png')
      await handler.events['msg:document']!(ctx)

      expect(ctx.reply).not.toHaveBeenCalled()
    })

    it('should silence file size limit errors', async () => {
      vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new LimitExceededError())
      setDocument('document-1', 'image/png')

      await handler.events['msg:document']!(ctx)

      expect(params().base_file_ids).toEqual([])
      expect(ctx.reply).not.toHaveBeenCalled()
    })
  })

  describe('msg:text', () => {
    it('should ask for photos when /ready is sent without photos', async () => {
      setText('/ready')

      await handler.events['msg:text']!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('Send up to 3')
      expect(params().step).toBe('collecting_bases')
    })

    it('should move to the watermark step when /ready is sent with photos', async () => {
      setParams({ base_file_ids: ['photo-1'] })
      setText('/ready')

      await handler.events['msg:text']!(ctx)

      expect(params().step).toBe('awaiting_watermark')
      expect(ctx.reply).toHaveBeenCalledWith('watermark_send_mark')
    })

    it('should accept /ready with the bot username', async () => {
      setParams({ base_file_ids: ['photo-1'] })
      setText('/ready@picture_studio_bot')

      await handler.events['msg:text']!(ctx)

      expect(params().step).toBe('awaiting_watermark')
    })

    it('should ignore unrelated text', async () => {
      setParams({ base_file_ids: ['photo-1'] })
      setText('hello')

      await handler.events['msg:text']!(ctx)

      expect(ctx.reply).not.toHaveBeenCalled()
      expect(params().step).toBe('collecting_bases')
    })

    it('should ignore /ready outside the collection step', async () => {
      setParams({ step: 'awaiting_watermark', base_file_ids: ['photo-1'] })
      setText('/ready')

      await handler.events['msg:text']!(ctx)

      expect(ctx.reply).not.toHaveBeenCalled()
    })
  })

  describe('watermark file', () => {
    it('should validate the file, check transparency and move to positions', async () => {
      setParams({ step: 'awaiting_watermark', base_file_ids: ['base-1'] })
      setDocument('mark', 'image/png')
      downloads.set('mark', '/tmp/mark.png')
      metadata().set('/tmp/mark.png', {
        width: 200,
        height: 100,
        format: 'png',
        hasAlpha: true,
        autoOrient: { width: 200, height: 100 },
      })

      await handler.events['msg:document']!(ctx)

      expect(params().step).toBe('positions')
      expect(params().watermark_file_id).toBe('mark')
      expect(params().callback_message_id).toBe(100)
      expect(ctx.reply).toHaveBeenCalledWith('watermark_choose_positions', {
        reply_markup: expect.any(InlineKeyboard),
      })
      expect(fs.rm).toHaveBeenCalledWith('/tmp/mark.png', { force: true })
    })

    it('should enforce the limit against the downloaded watermark size', async () => {
      setParams({ step: 'awaiting_watermark', base_file_ids: ['base-1'] })
      setDocument('mark', 'image/png')
      downloads.set('mark', '/tmp/mark.png')
      metadata().set('/tmp/mark.png', {
        width: 200,
        height: 100,
        format: 'png',
        hasAlpha: true,
        autoOrient: { width: 200, height: 100 },
      })
      vi.mocked(fs.stat).mockResolvedValueOnce({ size: 20 * 1024 * 1024 } as any)

      await handler.events['msg:document']!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('free_limit_reached')
      expect(params().step).toBe('awaiting_watermark')
    })

    it('should warn when the watermark has no transparency', async () => {
      setParams({ step: 'awaiting_watermark', base_file_ids: ['base-1'] })
      setDocument('mark', 'image/jpeg')
      downloads.set('mark', '/tmp/mark.jpg')
      metadata().set('/tmp/mark.jpg', {
        width: 200,
        height: 100,
        format: 'jpeg',
        hasAlpha: false,
        autoOrient: { width: 200, height: 100 },
      })

      await handler.events['msg:document']!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith(
        'watermark_choose_positions\n\nwatermark_no_transparency',
        { reply_markup: expect.any(InlineKeyboard) },
      )
    })

    it('should reject an unsupported watermark mime type', async () => {
      setParams({ step: 'awaiting_watermark', base_file_ids: ['base-1'] })
      setDocument('mark', 'image/gif')

      await handler.events['msg:document']!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('watermark_unsupported_format')
      expect(params().step).toBe('awaiting_watermark')
    })

    it('should reject an invalid watermark image', async () => {
      setParams({ step: 'awaiting_watermark', base_file_ids: ['base-1'] })
      setDocument('mark', 'image/png')
      downloads.set('mark', '/tmp/mark.png')
      metadata().set('/tmp/mark.png', new Error('invalid'))

      await handler.events['msg:document']!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('watermark_invalid_file')
      expect(params().step).toBe('awaiting_watermark')
    })

    it('should reject a watermark without dimensions', async () => {
      setParams({ step: 'awaiting_watermark', base_file_ids: ['base-1'] })
      setDocument('mark', 'image/png')
      downloads.set('mark', '/tmp/mark.png')
      metadata().set('/tmp/mark.png', {
        width: 0,
        height: 0,
        format: 'png',
        hasAlpha: true,
        autoOrient: { width: 0, height: 0 },
      })

      await handler.events['msg:document']!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('watermark_invalid_file')
      expect(params().step).toBe('awaiting_watermark')
    })

    it('should silence file size limit errors', async () => {
      setParams({ step: 'awaiting_watermark', base_file_ids: ['base-1'] })
      vi.spyOn(handler as any, 'checkLimits').mockRejectedValueOnce(new LimitExceededError())
      setDocument('mark', 'image/png')

      await handler.events['msg:document']!(ctx)

      expect(ctx.reply).not.toHaveBeenCalled()
      expect(params().step).toBe('awaiting_watermark')
    })
  })

  describe('callback_query', () => {
    it('should alert when ready is pressed without photos', async () => {
      setCallback('watermark_ready')

      await handler.events.callback_query!(ctx)

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
        text: 'watermark_ready_alert',
        show_alert: true,
      })
      expect(ctx.editMessageText).not.toHaveBeenCalled()
    })

    it('should move to the watermark step when ready is pressed with photos', async () => {
      setParams({ base_file_ids: ['photo-1'] })
      setCallback('watermark_ready')

      await handler.events.callback_query!(ctx)

      expect(params().step).toBe('awaiting_watermark')
      expect(ctx.answerCallbackQuery).toHaveBeenCalled()
      expect(ctx.editMessageText).toHaveBeenCalledWith('watermark_send_mark')
    })

    it('should ignore ready when the collection is already finished', async () => {
      setParams({ step: 'awaiting_watermark', base_file_ids: ['photo-1'] })
      setCallback('watermark_ready')

      await handler.events.callback_query!(ctx)

      expect(ctx.answerCallbackQuery).toHaveBeenCalled()
      expect(ctx.editMessageText).not.toHaveBeenCalled()
    })

    it('should toggle a corner and update the keyboard', async () => {
      prepareConfigured()
      setCallback('watermark_toggle_tl', 100)

      await handler.events.callback_query!(ctx)

      expect(params().positions).toEqual(['top-left'])
      expect(ctx.answerCallbackQuery).toHaveBeenCalled()
      expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith({
        reply_markup: expect.any(InlineKeyboard),
      })

      const keyboard = (vi.mocked(ctx.editMessageReplyMarkup).mock.calls[0][0] as any)
        .reply_markup as InlineKeyboard
      expect(keyboard.inline_keyboard[0][0].text).toContain('✅')
    })

    it('should remove an already selected corner', async () => {
      prepareConfigured({ positions: ['top-left', 'bottom-right'] })
      setCallback('watermark_toggle_tl', 100)

      await handler.events.callback_query!(ctx)

      expect(params().positions).toEqual(['bottom-right'])
    })

    it('should keep corners in canonical order', async () => {
      prepareConfigured()
      setCallback('watermark_toggle_br', 100)
      await handler.events.callback_query!(ctx)

      setCallback('watermark_toggle_tl', 100)
      await handler.events.callback_query!(ctx)

      expect(params().positions).toEqual(['top-left', 'bottom-right'])
    })

    it('should alert when applying without corners', async () => {
      prepareConfigured()
      setCallback('watermark_apply', 100)

      await handler.events.callback_query!(ctx)

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
        text: 'watermark_select_at_least_one',
        show_alert: true,
      })
      expect(params().step).toBe('positions')
    })

    it('should move to the scale step after applying', async () => {
      prepareConfigured({ positions: ['top-left'] })
      setCallback('watermark_apply', 100)

      await handler.events.callback_query!(ctx)

      expect(params().step).toBe('scale')
      expect(ctx.editMessageText).toHaveBeenCalledWith('watermark_choose_scale', {
        reply_markup: expect.any(InlineKeyboard),
      })
    })

    it('should go back from scale to corners', async () => {
      prepareConfigured({ step: 'scale', positions: ['bottom-left'] })
      setCallback('watermark_back', 100)

      await handler.events.callback_query!(ctx)

      expect(params().step).toBe('positions')
      expect(ctx.editMessageText).toHaveBeenCalledWith('watermark_choose_positions', {
        reply_markup: expect.any(InlineKeyboard),
      })
    })

    it('should cancel and reset the session', async () => {
      prepareConfigured()
      setCallback('watermark_cancel', 100)

      await handler.events.callback_query!(ctx)

      expect(ctx.answerCallbackQuery).toHaveBeenCalled()
      expect(ctx.session.command).toBeNull()
      expect(ctx.session.params).toBeNull()
      expect(ctx.editMessageText).toHaveBeenCalledWith('watermark_cancelled')
    })

    it('should accept a callback from the current keyboard', async () => {
      prepareConfigured({ positions: ['top-left'], callback_message_id: 100 })
      setCallback('watermark_apply', 100)

      await handler.events.callback_query!(ctx)

      expect(params().step).toBe('scale')
    })

    it('should ignore a corner callback from an older keyboard', async () => {
      prepareConfigured({ callback_message_id: 100 })
      setCallback('watermark_toggle_tl', 999)

      await handler.events.callback_query!(ctx)

      expect(params().positions).toEqual([])
      expect(ctx.editMessageReplyMarkup).not.toHaveBeenCalled()
    })

    it('should ignore an apply callback from an older keyboard', async () => {
      prepareConfigured({ positions: ['top-left'], callback_message_id: 100 })
      setCallback('watermark_apply', 999)

      await handler.events.callback_query!(ctx)

      expect(params().step).toBe('positions')
      expect(ctx.editMessageText).not.toHaveBeenCalled()
    })

    it('should ignore a back callback from an older keyboard', async () => {
      prepareConfigured({ step: 'scale', positions: ['top-left'], callback_message_id: 100 })
      setCallback('watermark_back', 999)

      await handler.events.callback_query!(ctx)

      expect(params().step).toBe('scale')
      expect(ctx.editMessageText).not.toHaveBeenCalled()
    })

    it('should ignore a scale callback from an older keyboard', async () => {
      prepareConfigured({ step: 'scale', positions: ['top-left'], callback_message_id: 100 })
      setCallback('watermark_scale_medium', 999)

      await handler.events.callback_query!(ctx)

      expect(userRepository.incrementUsage).not.toHaveBeenCalled()
      expect(params().step).toBe('scale')
    })

    it('should ignore a cancel callback from an older keyboard', async () => {
      prepareConfigured({ callback_message_id: 100 })
      setCallback('watermark_cancel', 999)

      await handler.events.callback_query!(ctx)

      expect(ctx.session.command).toBe(CommandEnum.Watermark)
      expect(ctx.editMessageText).not.toHaveBeenCalled()
    })

    it('should cancel when the callback matches the stored keyboard', async () => {
      prepareConfigured({ callback_message_id: 100 })
      setCallback('watermark_cancel', 100)

      await handler.events.callback_query!(ctx)

      expect(ctx.session.command).toBeNull()
      expect(ctx.session.params).toBeNull()
      expect(ctx.editMessageText).toHaveBeenCalledWith('watermark_cancelled')
    })

    it('should reject corner and apply callbacks when callback_message_id is missing', async () => {
      prepareConfigured({ callback_message_id: undefined })
      setCallback('watermark_toggle_tl')

      await handler.events.callback_query!(ctx)

      expect(params().positions).toEqual([])
      expect(ctx.answerCallbackQuery).toHaveBeenCalled()
      expect(ctx.editMessageReplyMarkup).not.toHaveBeenCalled()

      setCallback('watermark_apply')
      await handler.events.callback_query!(ctx)

      expect(params().step).toBe('positions')
      expect(ctx.editMessageText).not.toHaveBeenCalled()
    })

    it('should reject cancel callback when callback_message_id is missing', async () => {
      prepareConfigured({ callback_message_id: undefined })
      setCallback('watermark_cancel')

      await handler.events.callback_query!(ctx)

      expect(ctx.answerCallbackQuery).toHaveBeenCalled()
      expect(ctx.session.command).toBe(CommandEnum.Watermark)
      expect(ctx.editMessageText).not.toHaveBeenCalled()
    })

    it('should ignore unrelated callbacks', async () => {
      setCallback('something_else')

      await handler.events.callback_query!(ctx)

      expect(ctx.answerCallbackQuery).not.toHaveBeenCalled()
      expect(ctx.reply).not.toHaveBeenCalled()
    })

    it('should ignore a corner callback outside the positions step', async () => {
      setParams({ base_file_ids: ['photo-1'] })
      setCallback('watermark_toggle_tl')

      await handler.events.callback_query!(ctx)

      expect(ctx.answerCallbackQuery).toHaveBeenCalled()
      expect(ctx.editMessageReplyMarkup).not.toHaveBeenCalled()
      expect(params().step).toBe('collecting_bases')
      expect(params().base_file_ids).toEqual(['photo-1'])
    })

    it('should ignore an apply callback outside the positions step', async () => {
      setParams({ base_file_ids: ['photo-1'] })
      setCallback('watermark_apply')

      await handler.events.callback_query!(ctx)

      expect(ctx.answerCallbackQuery).toHaveBeenCalled()
      expect(ctx.editMessageText).not.toHaveBeenCalled()
      expect(params().step).toBe('collecting_bases')
      expect(params().base_file_ids).toEqual(['photo-1'])
    })

    it('should ignore a back callback outside the scale step', async () => {
      prepareConfigured({ positions: ['top-left'] })
      setCallback('watermark_back')

      await handler.events.callback_query!(ctx)

      expect(ctx.answerCallbackQuery).toHaveBeenCalled()
      expect(ctx.editMessageText).not.toHaveBeenCalled()
      expect(params().step).toBe('positions')
    })

    it('should ignore a scale callback outside the scale step', async () => {
      prepareConfigured({ positions: ['top-left'] })
      setCallback('watermark_scale_medium', 100)

      await handler.events.callback_query!(ctx)

      expect(ctx.answerCallbackQuery).toHaveBeenCalled()
      expect(ctx.editMessageText).not.toHaveBeenCalled()
      expect(userRepository.incrementUsage).not.toHaveBeenCalled()
      expect(params().step).toBe('positions')
    })
  })

  describe('processing', () => {
    it('should send a single document for one photo and count one usage', async () => {
      prepareProcessing([{ id: 'base-1' }])
      setCallback('watermark_scale_medium', 100)

      await handler.events.callback_query!(ctx)

      expect(ctx.replyWithDocument).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'watermarked-1.jpg' }),
        { caption: 'watermark_success' },
      )
      expect(ctx.replyWithMediaGroup).not.toHaveBeenCalled()
      expect(userRepository.incrementUsage).toHaveBeenCalledTimes(1)
      expect(userRepository.incrementUsage).toHaveBeenCalledWith(1, 3)
      expect(ctx.session.command).toBeNull()
      expect(ctx.session.params).toBeNull()
    })

    it('should send two to ten photos as a single album', async () => {
      prepareProcessing([
        { id: 'base-1' },
        { id: 'base-2' },
        { id: 'base-3' },
      ])
      setCallback('watermark_scale_auto', 100)

      await handler.events.callback_query!(ctx)

      expect(ctx.replyWithMediaGroup).toHaveBeenCalledTimes(1)
      expect(ctx.replyWithDocument).not.toHaveBeenCalled()

      const media = sentMedia()
      expect(media).toHaveLength(3)
      expect(media[0].caption).toBe('Batch 1/1')
      expect(media[1].caption).toBeUndefined()
      expect(media[2].caption).toBeUndefined()
      expect(media.map(item => item.media.name)).toEqual([
        'watermarked-1.jpg',
        'watermarked-2.jpg',
        'watermarked-3.jpg',
      ])
    })

    it('should split eleven photos into an album of ten and a single document', async () => {
      ctx.user = { plan_type: PlanTypeEnum.Pro } as any
      prepareProcessing(
        Array.from({ length: 11 }, (_, index) => ({ id: `base-${index + 1}` })),
      )
      setCallback('watermark_scale_large', 100)

      await handler.events.callback_query!(ctx)

      expect(ctx.replyWithMediaGroup).toHaveBeenCalledTimes(1)
      expect(sentMedia()).toHaveLength(10)
      expect(ctx.replyWithDocument).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'watermarked-11.jpg' }),
        { caption: 'Batch 2/2' },
      )
      expect(userRepository.incrementUsage).toHaveBeenCalledTimes(1)
    })

    it('should preserve the original format of each photo', async () => {
      prepareProcessing([
        { id: 'base-1', format: 'jpeg' },
        { id: 'base-2', format: 'png' },
      ])
      setCallback('watermark_scale_medium', 100)

      await handler.events.callback_query!(ctx)

      const media = sentMedia()
      expect(media.map(item => item.media.name)).toEqual([
        'watermarked-1.jpg',
        'watermarked-2.png',
      ])

      const formats = vi.mocked(sharp).mock.results.map(result => (result.value as any).toFormat.mock.calls).flat().map(call => call[0])

      expect(formats).toEqual(['jpeg', 'png'])
    })

    it('should treat AVIF content as an avif output', async () => {
      prepareProcessing([
        { id: 'base-1', format: 'heif', compression: 'av1' },
      ])
      setCallback('watermark_scale_medium', 100)

      await handler.events.callback_query!(ctx)

      expect(ctx.replyWithDocument).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'watermarked-1.avif' }),
        { caption: 'watermark_success' },
      )

      const formatCalls = vi.mocked(sharp).mock.results.map(result => (result.value as any).toFormat.mock.calls).flat()

      expect(formatCalls).toEqual([['avif', { quality: 90 }]])
    })

    it('should size the watermark based on each photo width', async () => {
      prepareProcessing([
        { id: 'base-1', width: 1000, height: 800 },
        { id: 'base-2', width: 2000, height: 800 },
      ])
      setCallback('watermark_scale_medium', 100)

      await handler.events.callback_query!(ctx)

      const resizeCalls = vi.mocked(sharp).mock.calls.map((call, index) => ({
        input: call[0],
        instance: vi.mocked(sharp).mock.results[index].value as any,
      })).filter(({ input }) => Buffer.isBuffer(input)).map(({ instance }) => instance.resize.mock.calls[0])

      expect(resizeCalls).toEqual([
        [200, 100, { fit: 'fill' }],
        [400, 200, { fit: 'fill' }],
      ])
    })

    it('should place the watermark in the selected corner', async () => {
      prepareProcessing([{ id: 'base-1', width: 100, height: 100 }], {
        positions: ['bottom-right'],
        scale: 'auto',
      })
      setCallback('watermark_scale_auto', 100)

      await handler.events.callback_query!(ctx)

      const composeInstance = vi.mocked(sharp).mock.results.map(result => result.value as any).find(instance => instance.composite.mock.calls.length > 0)

      expect(composeInstance.composite.mock.calls[0][0]).toEqual([
        {
          input: expect.any(Buffer),
          left: 77,
          top: 84,
        },
      ])
    })

    it('should place the watermark correctly on an EXIF-rotated image', async () => {
      prepareProcessing([{ id: 'base-1', width: 100, height: 50 }], {
        positions: ['bottom-right'],
        scale: 'auto',
      })
      // Simulate EXIF rotation: stored dimensions (100x50) vs auto-oriented (50x100)
      metadata().set('/tmp/base-1.jpg', {
        width: 100,
        height: 50,
        format: 'jpeg',
        hasAlpha: false,
        autoOrient: { width: 50, height: 100 },
      })
      setCallback('watermark_scale_auto', 100)

      await handler.events.callback_query!(ctx)

      const composeInstance = vi.mocked(sharp).mock.results.map(result => result.value as any).find(instance => instance.composite.mock.calls.length > 0)

      expect(composeInstance.composite.mock.calls[0][0]).toEqual([
        {
          input: expect.any(Buffer),
          left: expect.any(Number),
          top: expect.any(Number),
        },
      ])
    })

    it('should send successful photos and warn about partial failures', async () => {
      prepareProcessing([
        { id: 'base-1' },
        { id: 'base-2' },
      ])
      getFileImpl = async (fileId) => {
        if (fileId === 'base-2') {
          throw new Error('download failed')
        }

        return {
          file_id: fileId,
          file_size: 100,
          download: vi.fn().mockResolvedValue(downloads.get(fileId) ?? `/tmp/${fileId}`),
        }
      }
      setCallback('watermark_scale_medium', 100)

      await handler.events.callback_query!(ctx)

      expect(ctx.replyWithDocument).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'watermarked-1.jpg' }),
        { caption: 'watermark_success' },
      )
      expect(ctx.reply).toHaveBeenCalledWith('Failures failed=1 success=1 total=2')
      expect(ctx.editMessageText).toHaveBeenCalledWith('Summary 1/2')
      expect(userRepository.incrementUsage).toHaveBeenCalledTimes(1)
      expect(userRepository.decrementUsage).not.toHaveBeenCalled()
    })

    it('should refund the usage when no photo can be processed', async () => {
      prepareProcessing([
        { id: 'base-1' },
        { id: 'base-2' },
      ])
      getFileImpl = async (fileId) => {
        if (fileId.startsWith('base-')) {
          throw new Error('download failed')
        }

        return {
          file_id: fileId,
          file_size: 100,
          download: vi.fn().mockResolvedValue(downloads.get(fileId) ?? `/tmp/${fileId}`),
        }
      }
      setCallback('watermark_scale_medium', 100)

      await handler.events.callback_query!(ctx)

      expect(ctx.replyWithDocument).not.toHaveBeenCalled()
      expect(ctx.replyWithMediaGroup).not.toHaveBeenCalled()
      expect(ctx.reply).toHaveBeenCalledWith('watermark_no_valid_photos')
      expect(userRepository.incrementUsage).toHaveBeenCalledTimes(1)
      expect(userRepository.decrementUsage).toHaveBeenCalledWith(1)
      expect(ctx.session.params).toBeNull()
    })

    it('should report an invalid watermark instead of invalid photos', async () => {
      prepareProcessing([
        { id: 'base-1' },
      ])
      metadata().set('/tmp/mark.png', new Error('invalid'))
      setCallback('watermark_scale_medium', 100)

      await handler.events.callback_query!(ctx)

      expect(ctx.replyWithDocument).not.toHaveBeenCalled()
      expect(ctx.replyWithMediaGroup).not.toHaveBeenCalled()
      expect(ctx.reply).toHaveBeenCalledWith('watermark_invalid_file')
      expect(ctx.reply).not.toHaveBeenCalledWith('watermark_no_valid_photos')
      expect(userRepository.decrementUsage).toHaveBeenCalledWith(1)
      expect(ctx.session.params).toBeNull()
    })

    it('should report progress and edit the final summary', async () => {
      prepareProcessing([
        { id: 'base-1' },
        { id: 'base-2' },
        { id: 'base-3' },
      ])
      setCallback('watermark_scale_medium', 100)

      await handler.events.callback_query!(ctx)

      const edits = vi.mocked(ctx.editMessageText).mock.calls.map(call => call[0])
      expect(edits).toContain('Processing 3')
      expect(edits).toContain('Progress 3/3')
      expect(edits).toContain('Summary 3/3')
    })

    it('should clean up inputs, outputs and the watermark file', async () => {
      prepareProcessing([{ id: 'base-1' }])
      setCallback('watermark_scale_medium', 100)

      await handler.events.callback_query!(ctx)

      expect(fs.rm).toHaveBeenCalledWith('/tmp/base-1.jpg', { force: true })
      expect(fs.rm).toHaveBeenCalledWith('/tmp/mark.png', { force: true })
      expect(fs.rm).toHaveBeenCalledWith(
        expect.stringMatching(/\/tmp\/watermark-[a-f0-9-]+\.jpg$/),
        { force: true },
      )
    })

    it('should refund the usage when usage cannot be reserved', async () => {
      prepareProcessing([{ id: 'base-1' }])
      vi.mocked(userRepository.incrementUsage).mockResolvedValueOnce(null)
      setCallback('watermark_scale_medium', 100)

      await handler.events.callback_query!(ctx)

      expect(ctx.replyWithDocument).not.toHaveBeenCalled()
      expect(userRepository.decrementUsage).not.toHaveBeenCalled()
      expect(ctx.session.params).toBeNull()
    })

    it('should deduplicate extra photos beyond the plan limit before processing', async () => {
      prepareProcessing([
        { id: 'base-1' },
        { id: 'base-2' },
        { id: 'base-3' },
        { id: 'base-4' },
      ])
      setCallback('watermark_scale_medium', 100)

      await handler.events.callback_query!(ctx)

      expect(sentMedia()).toHaveLength(3)
    })

    it('should enforce the limit against the downloaded photo size', async () => {
      prepareProcessing([{ id: 'base-1' }])
      vi.mocked(fs.stat).mockImplementation(async (path: any) => ({
        size: String(path).includes('base-1') ? 20 * 1024 * 1024 : 100,
      }) as any)
      setCallback('watermark_scale_medium', 100)

      await handler.events.callback_query!(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('free_limit_reached')
      expect(ctx.replyWithDocument).not.toHaveBeenCalled()
      expect(userRepository.decrementUsage).toHaveBeenCalledWith(1)
    })

    it('should not distort a mark too tall to fit within the height cap', async () => {
      prepareProcessing([{ id: 'base-1', width: 1000, height: 800 }])
      metadata().set('/tmp/mark.png', {
        width: 1,
        height: 100000,
        format: 'png',
        hasAlpha: true,
        autoOrient: { width: 1, height: 100000 },
      })
      setCallback('watermark_scale_medium', 100)

      await handler.events.callback_query!(ctx)

      expect(ctx.replyWithDocument).not.toHaveBeenCalled()
      expect(ctx.replyWithMediaGroup).not.toHaveBeenCalled()
      expect(ctx.reply).toHaveBeenCalledWith('watermark_no_valid_photos')
      expect(userRepository.decrementUsage).toHaveBeenCalledWith(1)
    })

    it('should reject a base image shorter than the minimum watermark height cap', async () => {
      prepareProcessing([{ id: 'base-1', width: 10, height: 3 }])
      metadata().set('/tmp/mark.png', {
        width: 2,
        height: 1,
        format: 'png',
        hasAlpha: true,
        autoOrient: { width: 2, height: 1 },
      })
      setCallback('watermark_scale_medium', 100)

      await handler.events.callback_query!(ctx)

      expect(ctx.replyWithDocument).not.toHaveBeenCalled()
      expect(ctx.replyWithMediaGroup).not.toHaveBeenCalled()
      expect(ctx.reply).toHaveBeenCalledWith('watermark_no_valid_photos')
      expect(userRepository.decrementUsage).toHaveBeenCalledWith(1)
    })
  })
})
