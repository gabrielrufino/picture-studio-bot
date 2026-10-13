import { describe, expect, it } from 'vitest'
import { UserNotFoundError } from './user-not-found.error'

describe(UserNotFoundError.name, () => {
  it('should have correct message and name', () => {
    const error = new UserNotFoundError()
    expect(error.message).toBe('User not found.')
    expect(error.name).toBe('UserNotFoundError')
    expect(error).toBeInstanceOf(Error)
  })
})
