import type { BaseHandler } from './base.handler'
import type { CustomContext } from '@/types/custom-context.type'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandEnum } from '@/enums/command.enum'
import { HelpHandler } from './help.handler'

describe(HelpHandler.name, () => {
  const mockHandlers = [
    { command: 'compress', description: '🗜️ Compress an image', onCommand: vi.fn() },
    { command: 'convert', description: '🔄 Convert an image format', onCommand: vi.fn() },
    { command: 'crop', description: '✂️ Crop an image', onCommand: vi.fn() },
    { command: 'resize', description: '📐 Resize an image', onCommand: vi.fn() },
    { command: 'rotate', description: '🔄 Rotate an image', onCommand: vi.fn() },
  ] as unknown as BaseHandler[]

  let handler: HelpHandler
  let ctx: CustomContext

  beforeEach(() => {
    handler = new HelpHandler(mockHandlers)
    ctx = { t: (key: string) => key, reply: vi.fn(), answerCallbackQuery: vi.fn(), deleteMessage: vi.fn().mockResolvedValue(undefined), callbackQuery: {
      data: 'compress',
    } } as unknown as CustomContext
  })

  it('should have correct command', () => {
    expect(handler.command).toBe(CommandEnum.Help)
  })

  describe(HelpHandler.prototype.onCommand.name, () => {
    it('should reply with a dynamically generated help message', async () => {
      await handler.onCommand(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('help_select_operation', expect.objectContaining({ reply_markup: expect.anything() }))
    })
  })

  describe('events', () => {
    it('should handle callback_query and call onCommand of the selected handler', async () => {
      const compressHandler = mockHandlers[0]
      const onCommandSpy = vi.spyOn(compressHandler, 'onCommand').mockResolvedValue(undefined)

      await handler.events.callback_query(ctx)

      expect(ctx.answerCallbackQuery).toHaveBeenCalled()
      expect(ctx.deleteMessage).toHaveBeenCalled()
      expect(onCommandSpy).toHaveBeenCalledWith(ctx)
    })

    it('should handle callback_query and only answer if deleteMessage fails', async () => {
      const error = new Error('Failed to delete')
      ctx.deleteMessage = vi.fn().mockRejectedValue(error)
      const compressHandler = mockHandlers[0]
      const onCommandSpy = vi.spyOn(compressHandler, 'onCommand').mockResolvedValue(undefined)
      const loggerSpy = vi.spyOn((handler as any).logger, 'error')

      await handler.events.callback_query(ctx)

      expect(ctx.answerCallbackQuery).toHaveBeenCalled()
      expect(loggerSpy).toHaveBeenCalledWith({ error }, 'Failed to delete help menu message')
      expect(onCommandSpy).toHaveBeenCalledWith(ctx)
    })

    it('should only answer the query if handler is not found', async () => {
      ctx.callbackQuery!.data = 'unknown'
      await handler.events.callback_query(ctx)

      expect(ctx.answerCallbackQuery).toHaveBeenCalled()
    })
  })
})
