import type { User as TelegramUser } from 'grammy/types'
import { LanguageEnum } from '../enums/language.enum'
import { PlanTypeEnum } from '../enums/plan-type.enum'
import { BaseEntity } from './base.entity'

export class UserEntity extends BaseEntity {
  constructor(input?: Partial<UserEntity>) {
    super()
    this.assign(input)
  }

  telegram_user: TelegramUser | null = null

  is_blocked: boolean = false

  is_bot_blocked: boolean = false

  plan_type?: PlanTypeEnum = PlanTypeEnum.Free

  plan_started_at?: Date | null = new Date()

  daily_usage_count: number = 0

  last_usage_date?: string = undefined

  language: LanguageEnum = LanguageEnum.English
}
