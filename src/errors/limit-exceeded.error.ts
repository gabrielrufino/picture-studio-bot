export class LimitExceededError extends Error {
  constructor() {
    super('Limit exceeded.')
    this.name = 'LimitExceededError'
  }
}
