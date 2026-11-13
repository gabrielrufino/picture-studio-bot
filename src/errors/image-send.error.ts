export class ImageSendError extends Error {
  constructor() {
    super('Failed to send the image.')
    this.name = 'ImageSendError'
  }
}
