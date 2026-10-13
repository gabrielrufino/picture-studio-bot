import { describe, expect, it } from 'vitest'
import { LanguageEnum } from '../enums/language.enum'
import { PlanTypeEnum } from '../enums/plan-type.enum'
import { UserEntity } from './user.entity'

describe(UserEntity.name, () => {
  it('should create a user entity with default values', () => {
    const user = new UserEntity()
    expect(user).toBeInstanceOf(UserEntity)
    expect(user.telegram_user).toBeNull()
    expect(user.is_blocked).toBe(false)
    expect(user.plan_type).toBe(PlanTypeEnum.Free)
    expect(user.plan_started_at).toBeInstanceOf(Date)
    expect(user.daily_usage_count).toBe(0)
    expect(user.last_usage_date).toBeUndefined()
    expect(user.language).toBe(LanguageEnum.English)
  })

  it('should create a user entity with provided input', () => {
    const customDate = new Date('2024-01-01')
    const user = new UserEntity({
      telegram_user: { id: 12345, first_name: 'John', is_bot: false },
      is_blocked: true,
      plan_type: PlanTypeEnum.Pro,
      plan_started_at: customDate,
      daily_usage_count: 5,
      last_usage_date: '2024-08-10',
      language: LanguageEnum.Spanish,
    })

    expect(user).toBeInstanceOf(UserEntity)
    expect(user.telegram_user).toEqual({ id: 12345, first_name: 'John', is_bot: false })
    expect(user.is_blocked).toBe(true)
    expect(user.plan_type).toBe(PlanTypeEnum.Pro)
    expect(user.plan_started_at).toBe(customDate)
    expect(user.daily_usage_count).toBe(5)
    expect(user.last_usage_date).toBe('2024-08-10')
    expect(user.language).toBe(LanguageEnum.Spanish)
  })
})
