import type { UserEntity } from '@/entities/user.entity'
import type { ConfigurationRepository } from '@/repositories/configuration.repository'
import type { PaymentRepository } from '@/repositories/payment.repository'
import type { UserRepository } from '@/repositories/user.repository'
import type { CustomContext } from '@/types/custom-context.type'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandEnum } from '@/enums/command.enum'
import { CurrencyEnum } from '@/enums/currency.enum'
import { PlanTypeEnum } from '@/enums/plan-type.enum'
import { ProHandler } from './pro.handler'

describe(ProHandler.name, () => {
  let handler: ProHandler
  let userRepository: UserRepository
  let paymentRepository: PaymentRepository
  let configurationRepository: ConfigurationRepository

  const createMockUser = (overrides?: Partial<UserEntity>): UserEntity => ({
    _id: 'user-id',
    telegram_user: { id: 12345 },
    plan_type: PlanTypeEnum.Free,
    ...overrides,
  } as unknown as UserEntity)

  const createMockContext = (overrides?: any): CustomContext => ({ t: (key: string) => key, from: { id: 12345 }, session: { command: null, params: null }, reply: vi.fn(), replyWithInvoice: vi.fn(), answerPreCheckoutQuery: vi.fn(), ...overrides } as unknown as CustomContext)

  beforeEach(() => {
    userRepository = {
      findByTelegramId: vi.fn().mockResolvedValue(null),
      updateById: vi.fn(),
    } as unknown as UserRepository

    paymentRepository = {
      create: vi.fn(),
    } as unknown as PaymentRepository

    configurationRepository = {
      findGlobalConfig: vi.fn().mockResolvedValue({
        _id: 'global_config',
        pro_price: 350,
        maintenance_mode: false,
        created_at: new Date(),
        updated_at: new Date(),
      }),
    } as unknown as ConfigurationRepository

    handler = new ProHandler(userRepository, paymentRepository, configurationRepository)
  })

  it('should be defined', () => {
    expect(handler).toBeDefined()
  })

  it('should have the correct command', () => {
    expect(handler.command).toBe(CommandEnum.Pro)
  })

  it('should have the correct description', () => {
    expect(handler.description).toBe('💎 Get PRO access')
  })

  describe(ProHandler.prototype.onCommand.name, () => {
    it('should show subscription info if user is already PRO', async () => {
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - 10)
      const existingUser = createMockUser({ plan_type: PlanTypeEnum.Pro, plan_started_at: startDate })
      vi.spyOn(userRepository, 'findByTelegramId').mockResolvedValueOnce(existingUser)

      const ctx = createMockContext({
        t: (key: string) => key === 'subscription_info' ? 'Active since {date}' : key,
      })

      await handler.onCommand(ctx)

      expect(ctx.reply).toHaveBeenCalledWith(`Active since ${startDate.toLocaleDateString()}`, { parse_mode: 'HTML' })
      expect(ctx.session.command).toBeNull()
    })

    it('should show dash when plan_started_at is null', async () => {
      const existingUser = createMockUser({ plan_type: PlanTypeEnum.Pro, plan_started_at: null })
      vi.spyOn(userRepository, 'findByTelegramId').mockResolvedValueOnce(existingUser)

      const ctx = createMockContext({
        t: (key: string) => key === 'subscription_info' ? 'Active since {date}' : key,
      })

      await handler.onCommand(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('Active since -', { parse_mode: 'HTML' })
      expect(ctx.session.command).toBeNull()
    })

    it('should downgrade to Free and notify when the Pro plan has expired', async () => {
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - 31)
      const existingUser = createMockUser({ plan_type: PlanTypeEnum.Pro, plan_started_at: startDate })
      vi.spyOn(userRepository, 'findByTelegramId').mockResolvedValueOnce(existingUser)

      const ctx = createMockContext({
        session: { command: CommandEnum.Pro, params: { file_id: 'photo-id' } },
      })

      await handler.onCommand(ctx)

      expect(userRepository.updateById).toHaveBeenCalledWith('user-id', {
        plan_type: PlanTypeEnum.Free,
        plan_started_at: null,
      })
      expect(ctx.reply).toHaveBeenCalledWith('pro_expired')
      expect(ctx.replyWithInvoice).not.toHaveBeenCalled()
      expect(ctx.session.command).toBeNull()
      expect(ctx.session.params).toBeNull()
    })

    it('should set session command and send invoice with pro_price from config', async () => {
      const existingUser = createMockUser()
      vi.spyOn(userRepository, 'findByTelegramId').mockResolvedValueOnce(existingUser)

      const ctx = createMockContext()

      await handler.onCommand(ctx)

      expect(ctx.session.command).toBe(CommandEnum.Pro)
      expect(ctx.replyWithInvoice).toHaveBeenCalledWith(
        'Picture Studio PRO',
        'pro_upgrade',
        'picture-studio-pro-subscription',
        CurrencyEnum.XTR,
        [{ label: 'PRO Subscription', amount: 350 }],
        {
          provider_token: '',
        },
      )
    })

    it('should use the pro_price from global config', async () => {
      const existingUser = createMockUser()
      vi.spyOn(userRepository, 'findByTelegramId').mockResolvedValueOnce(existingUser)
      vi.spyOn(configurationRepository, 'findGlobalConfig').mockResolvedValueOnce({
        _id: 'global_config',
        pro_price: 500,
        maintenance_mode: false,
        created_at: new Date(),
        updated_at: new Date(),
      })

      const ctx = createMockContext()

      await handler.onCommand(ctx)

      expect(configurationRepository.findGlobalConfig).toHaveBeenCalled()
      expect(ctx.replyWithInvoice).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        [{ label: 'PRO Subscription', amount: 500 }],
        expect.any(Object),
      )
    })

    it('should do nothing if ctx.from is missing', async () => {
      const ctx = createMockContext({ from: undefined })

      await handler.onCommand(ctx)

      expect(ctx.reply).not.toHaveBeenCalled()
      expect(ctx.replyWithInvoice).not.toHaveBeenCalled()
    })
  })

  describe('events', () => {
    describe('pre_checkout_query', () => {
      it('should answer the pre_checkout_query with true', async () => {
        const ctx = createMockContext()

        await handler.events.pre_checkout_query(ctx)

        expect(ctx.answerPreCheckoutQuery).toHaveBeenCalledWith(true)
      })
    })

    describe('message:successful_payment', () => {
      it('should update user plan to Pro and reply', async () => {
        const existingUser = createMockUser()
        vi.spyOn(userRepository, 'findByTelegramId').mockResolvedValueOnce(existingUser)

        const ctx = createMockContext({
          session: { command: CommandEnum.Pro, params: null },
          message: { successful_payment: { total_amount: 350, currency: CurrencyEnum.XTR } },
        })

        await handler.events['message:successful_payment'](ctx)

        expect(userRepository.updateById).toHaveBeenCalledWith('user-id', {
          plan_type: PlanTypeEnum.Pro,
          plan_started_at: expect.any(Date),
        })
        expect(paymentRepository.create).toHaveBeenCalled()
        expect(ctx.reply).toHaveBeenCalledWith('pro_success')
        expect(ctx.session.command).toBeNull()
      })

      it('should do nothing if ctx.from is missing', async () => {
        const ctx = createMockContext({ from: undefined })

        await handler.events['message:successful_payment'](ctx)

        expect(userRepository.findByTelegramId).not.toHaveBeenCalled()
        expect(userRepository.updateById).not.toHaveBeenCalled()
      })

      it('should do nothing if user is not found', async () => {
        vi.spyOn(userRepository, 'findByTelegramId').mockResolvedValueOnce(null)

        const ctx = createMockContext({
          session: { command: CommandEnum.Pro, params: null },
          message: { successful_payment: { total_amount: 350, currency: CurrencyEnum.XTR } },
        })

        await handler.events['message:successful_payment'](ctx)

        expect(userRepository.updateById).not.toHaveBeenCalled()
        expect(ctx.reply).not.toHaveBeenCalled()
      })
    })
  })
})
