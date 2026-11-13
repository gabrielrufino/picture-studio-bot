export class ImageSsrfBlockError extends Error {
  constructor() {
    super('Access blocked by security policy.')
    this.name = 'ImageSsrfBlockError'
  }
}
