import type { UserEntity } from '../entities/user.entity'
import type { UserRepository } from '../repositories/user.repository'
import type { CustomContext } from '../types/custom-context.type'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandEnum } from '../enums/command.enum'
import { WelcomeMessage } from '../messages/welcome.message'
import { StartHandler } from './start.handler'

describe(StartHandler.name, () => {
  let handler: StartHandler
  let userRepository: UserRepository

  beforeEach(() => {
    userRepository = {
      create: vi.fn(),
      findByTelegramId: vi.fn().mockResolvedValue(null),
      updateById: vi.fn(),
    } as unknown as UserRepository

    handler = new StartHandler(userRepository)
  })

  it('should be defined', () => {
    expect(handler).toBeDefined()
  })

  it('should have the correct command', () => {
    expect(handler.command).toBe(CommandEnum.Start)
  })

  describe(StartHandler.prototype.onCommand.name, () => {
    it('should create a new user if not found', async () => {
      const ctx: any = {
        t: (key: string) => key,
        from: {
          id: 12345,
        },
        session: {
          command: null,
          params: null,
        },
        reply: vi.fn(),
      } as unknown as CustomContext

      await handler.onCommand(ctx)

      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          telegram_user: ctx.from,
        }),
      )
    })

    it('should update the user if found', async () => {
      const existingUser = {
        _id: 'user-id',
        telegram_user: {
          id: 12345,
        },
      } as unknown as UserEntity
      vi.spyOn(userRepository, 'findByTelegramId')
        .mockResolvedValueOnce(existingUser)

      const ctx: any = {
        t: (key: string) => key,
        from: {
          id: 12345,
        },
        user: existingUser,
        session: {
          command: null,
          params: null,
        },
        reply: vi.fn(),
      } as unknown as CustomContext

      await handler.onCommand(ctx)

      expect(userRepository.updateById).toHaveBeenCalledWith('user-id', existingUser)
    })

    it('should send the welcome message', async () => {
      const ctx: any = {
        t: (key: string) => key,
        from: {
          id: 12345,
        },
        session: {
          command: null,
          params: null,
        },
        reply: vi.fn(),
      } as unknown as CustomContext

      await handler.onCommand(ctx)

      expect(ctx.reply).toHaveBeenCalledTimes(1)
      expect(ctx.reply).toHaveBeenCalledWith(
        new WelcomeMessage(ctx)
          .build(),
        { parse_mode: 'HTML' },
      )
    })

    it('should reset the session', async () => {
      const ctx: any = {
        t: (key: string) => key,
        from: {
          id: 12345,
        },
        session: {
          command: CommandEnum.Start,
          params: { foo: 'bar' },
        },
        reply: vi.fn(),
      } as unknown as CustomContext

      await handler.onCommand(ctx)

      expect(ctx.session.command).toBeNull()
      expect(ctx.session.params).toBeNull()
    })
  })
})
