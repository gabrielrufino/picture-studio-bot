import type { MessageEntity } from '../entities/message.entity'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../config/logger'
import { CommandEnum } from '../enums/command.enum'
import { messageRepository } from '../repositories'
import { messageRecorderMiddleware } from './message-recorder.middleware'

vi.mock('../repositories', () => ({
  messageRepository: {
    create: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../config/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

describe(messageRecorderMiddleware.name, () => {
  let next: any
  let ctx: any

  beforeEach(() => {
    next = vi.fn()
    ctx = { t: (key: string) => key, from: { id: 12345 }, message: { text: 'hello' }, session: { command: null } }
    vi.clearAllMocks()
  })

  it('should create a message record and call next', async () => {
    await messageRecorderMiddleware(ctx, next)

    expect(messageRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      telegram_user: ctx.from,
    }))
    expect(next).toHaveBeenCalled()
  })

  it('should mask password text if command is PutPassword', async () => {
    ctx.session.command = CommandEnum.PutPassword
    ctx.message.text = 'secret123'

    await messageRecorderMiddleware(ctx, next)

    expect(messageRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      text: '***',
      telegram_user: ctx.from,
    }))
    expect(next).toHaveBeenCalled()
  })

  it('should mask password text if command is RemovePassword', async () => {
    ctx.session.command = CommandEnum.RemovePassword
    ctx.message.text = 'secret123'

    await messageRecorderMiddleware(ctx, next)

    expect(messageRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      text: '***',
      telegram_user: ctx.from,
    }))
    expect(next).toHaveBeenCalled()
  })

  it('should handle missing message text', async () => {
    ctx.message.text = undefined

    await messageRecorderMiddleware(ctx, next)

    expect(messageRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      text: '',
    }))
    expect(next).toHaveBeenCalled()
  })

  it('should call next and do nothing if no message in context', async () => {
    ctx.message = undefined

    await messageRecorderMiddleware(ctx, next)

    expect(messageRepository.create).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
  })

  it('should call next without waiting for create to settle (non-blocking)', async () => {
    let resolveCreate!: () => void
    const deferredCreate = new Promise<MessageEntity>(resolve => (resolveCreate = resolve as () => void))
    vi.mocked(messageRepository.create).mockReturnValueOnce(deferredCreate)

    await messageRecorderMiddleware(ctx, next)

    // next() must have been called before create() resolved
    expect(next).toHaveBeenCalled()

    // Now resolve create and confirm no side-effects
    resolveCreate()
    await deferredCreate
  })

  it('should log an error if messageRepository.create fails', async () => {
    const testError = new Error('Database connection failed')
    vi.mocked(messageRepository.create).mockRejectedValueOnce(testError)

    await messageRecorderMiddleware(ctx, next)

    // Yield to the event loop so the unawaited promise catch block runs
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(logger.error).toHaveBeenCalledWith({ error: testError }, 'Failed to record message')
    expect(next).toHaveBeenCalled()
  })
})
