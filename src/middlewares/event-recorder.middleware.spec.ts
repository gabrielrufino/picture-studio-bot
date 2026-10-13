import { beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../config/logger'
import { EventEnum } from '../enums/event.enum'
import { eventRepository } from '../repositories'
import { eventRecorderMiddleware } from './event-recorder.middleware'

vi.mock('../config/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

vi.mock('../repositories', () => ({
  eventRepository: {
    create: vi.fn(),
    insertMany: vi.fn().mockResolvedValue([]),
  },
}))

describe(eventRecorderMiddleware.name, () => {
  const next = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call next if ctx.from is missing', async () => {
    const ctx: any = {}
    await eventRecorderMiddleware(ctx, next)
    expect(next).toHaveBeenCalled()
    expect(eventRepository.insertMany).not.toHaveBeenCalled()
  })

  it('should record specific CommandStart if message text starts with /start', async () => {
    const ctx: any = {
      from: { id: 123 },
      message: { text: '/start' },
    }
    await eventRecorderMiddleware(ctx, next)
    expect(next).toHaveBeenCalled()
    expect(eventRepository.insertMany).toHaveBeenCalledWith([expect.objectContaining({
      event: EventEnum.CommandStart,
      telegram_user: { id: 123 },
    })])
  })

  it('should record specific ButtonPro if callbackQuery data is pro', async () => {
    const ctx: any = {
      from: { id: 123 },
      callbackQuery: { data: 'pro' },
    }
    await eventRecorderMiddleware(ctx, next)
    expect(next).toHaveBeenCalled()
    expect(eventRepository.insertMany).toHaveBeenCalledWith([expect.objectContaining({
      event: EventEnum.ButtonPro,
      telegram_user: { id: 123 },
    })])
  })

  it('should record FileReceived if document is present', async () => {
    const ctx: any = {
      from: { id: 123 },
      message: { document: { mime_type: 'application/pdf' } },
    }
    await eventRecorderMiddleware(ctx, next)
    expect(next).toHaveBeenCalled()
    expect(eventRepository.insertMany).toHaveBeenCalledWith([expect.objectContaining({
      event: EventEnum.FileReceived,
      telegram_user: { id: 123 },
      metadata: { mime_type: 'application/pdf' },
    })])
  })

  it('should not record anything for unknown command', async () => {
    const ctx: any = {
      from: { id: 123 },
      message: { text: '/unknown' },
    }
    await eventRecorderMiddleware(ctx, next)
    expect(next).toHaveBeenCalled()
    expect(eventRepository.insertMany).not.toHaveBeenCalled()
  })

  it('should not record anything if no relevant update', async () => {
    const ctx: any = {
      from: { id: 123 },
      message: { text: 'hello' },
    }
    await eventRecorderMiddleware(ctx, next)
    expect(next).toHaveBeenCalled()
    expect(eventRepository.insertMany).not.toHaveBeenCalled()
  })

  it('should log error if insertMany fails', async () => {
    const error = new Error('Database error')
    vi.mocked(eventRepository.insertMany).mockRejectedValueOnce(error)

    const ctx: any = {
      from: { id: 123 },
      message: { text: '/start' },
    }

    await eventRecorderMiddleware(ctx, next)

    // Wait for the next tick to allow the catch block to execute
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(next).toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith({ error }, 'Failed to record events')
  })
})
