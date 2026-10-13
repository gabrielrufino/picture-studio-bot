import type { FeedbackRepository } from '../repositories/feedback.repository'
import type { CustomContext } from '../types/custom-context.type'
import { describe, expect, it, vi } from 'vitest'
import { CommandEnum } from '../enums/command.enum'
import { FeedbackHandler } from './feedback.handler'

describe(FeedbackHandler.name, () => {
  const feedbackRepositoryMock = {
    create: vi.fn().mockResolvedValue({} as any),
  } as unknown as FeedbackRepository

  it('should have correct command and events', () => {
    const handler = new FeedbackHandler(feedbackRepositoryMock)
    expect(handler.command).toBe(CommandEnum.Feedback)
    expect(handler.events).toHaveProperty('msg:text')
  })

  describe(FeedbackHandler.prototype.onCommand.name, () => {
    it('should set session command and send reply', async () => {
      const ctx: any = { t: (key: string) => key, session: { command: null, params: null }, reply: vi.fn().mockResolvedValue(undefined) } as unknown as CustomContext

      await new FeedbackHandler(feedbackRepositoryMock).onCommand(ctx)

      expect(ctx.session.command).toBe(CommandEnum.Feedback)
    })

    it('should send the correct reply message', async () => {
      const ctx: any = { t: (key: string) => key, session: { command: null, params: null }, reply: vi.fn().mockResolvedValue(undefined) } as unknown as CustomContext

      await new FeedbackHandler(feedbackRepositoryMock).onCommand(ctx)

      expect(ctx.reply).toHaveBeenCalledWith(
        'feedback_send_message',
      )
    })
  })

  describe('events[\'msg:text\']', () => {
    it('should create feedback and send thank you reply', async () => {
      const ctx: any = { t: (key: string) => key, session: { command: CommandEnum.Feedback, params: null }, from: { id: 123, first_name: 'John', is_bot: false, language_code: 'en' }, message: { text: 'Great service!' }, reply: vi.fn().mockResolvedValue(undefined) } as unknown as CustomContext

      await new FeedbackHandler(feedbackRepositoryMock).events['msg:text'](ctx)

      expect(feedbackRepositoryMock.create).toHaveBeenCalledWith(expect.objectContaining({
        telegram_user: ctx.from,
        text: ctx.message!.text,
        created_at: expect.any(Date),
      }))
      expect(ctx.reply).toHaveBeenCalledWith('feedback_success')
    })
  })
})
