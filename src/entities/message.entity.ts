import type { User as TelegramUser } from 'grammy/types'

import { BaseEntity } from './base.entity'

export class MessageEntity extends BaseEntity {
  constructor(input?: Partial<MessageEntity>) {
    super()
    this.assign(input)
  }

  declare telegram_user: TelegramUser

  text: string = ''
}
