export class SessionValidationError extends Error {
  constructor() {
    super('An error occurred. Please start the command again.')
    this.name = 'SessionValidationError'
  }
}
