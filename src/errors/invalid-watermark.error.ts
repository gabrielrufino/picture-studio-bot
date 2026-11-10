export class InvalidWatermarkError extends Error {
  constructor() {
    super('Invalid watermark image.')
    this.name = InvalidWatermarkError.name
  }
}
