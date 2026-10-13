import { describe, expect, it } from 'vitest'
import { InvalidFileError } from './invalid-file.error'
import { LimitExceededError } from './limit-exceeded.error'
import { SessionValidationError } from './session-validation.error'

describe('custom errors', () => {
  describe(InvalidFileError.name, () => {
    it('should have correct message and name', () => {
      const error = new InvalidFileError()
      expect(error.message).toBe('Invalid image type.')
      expect(error.name).toBe('InvalidFileError')
      expect(error).toBeInstanceOf(Error)
    })
  })

  describe(LimitExceededError.name, () => {
    it('should have correct message and name', () => {
      const error = new LimitExceededError()
      expect(error.message).toBe('Limit exceeded.')
      expect(error.name).toBe('LimitExceededError')
      expect(error).toBeInstanceOf(Error)
    })
  })

  describe(SessionValidationError.name, () => {
    it('should have correct message and name', () => {
      const error = new SessionValidationError()
      expect(error.message).toBe('An error occurred. Please start the command again.')
      expect(error.name).toBe('SessionValidationError')
      expect(error).toBeInstanceOf(Error)
    })
  })
})
