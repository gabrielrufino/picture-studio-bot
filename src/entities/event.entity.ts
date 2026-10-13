import type { User as TelegramUser } from 'grammy/types'
import type { EventEnum } from '../enums/event.enum'
import { BaseEntity } from './base.entity'

export class EventEntity extends BaseEntity {
  constructor(input?: Partial<EventEntity>) {
    super()
    this.assign(input)
  }

  declare event: EventEnum
  declare telegram_user: TelegramUser
  metadata?: Record<string, unknown>
}
