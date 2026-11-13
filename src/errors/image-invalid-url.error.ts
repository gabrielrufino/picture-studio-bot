export class ImageInvalidUrlError extends Error {
  constructor() {
    super('Invalid URL format.')
    this.name = 'ImageInvalidUrlError'
  }
}
