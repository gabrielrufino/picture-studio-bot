export class InvalidFileError extends Error {
  constructor() {
    super('Invalid image type.')
    this.name = 'InvalidFileError'
  }
}
