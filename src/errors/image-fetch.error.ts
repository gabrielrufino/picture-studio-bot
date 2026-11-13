export class ImageFetchError extends Error {
  constructor() {
    super('Failed to download the image.')
    this.name = 'ImageFetchError'
  }
}
