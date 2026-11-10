import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isPlanExpired } from './plan.util'

describe(isPlanExpired.name, () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-31T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return false when plan started less than 30 days ago', () => {
    const planStartedAt = new Date('2024-01-16T12:00:00.000Z')

    expect(isPlanExpired(planStartedAt)).toBe(false)
  })

  it('should return true when plan started more than 30 days ago', () => {
    const planStartedAt = new Date('2023-12-31T12:00:00.000Z')

    expect(isPlanExpired(planStartedAt)).toBe(true)
  })

  it('should return false when plan started at is null', () => {
    expect(isPlanExpired(null)).toBe(false)
  })

  it('should return false when plan started at is undefined', () => {
    expect(isPlanExpired(undefined)).toBe(false)
  })
})
