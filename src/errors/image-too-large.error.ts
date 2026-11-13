export class ImageTooLargeError extends Error {
  constructor() {
    super('File too large.')
    this.name = 'ImageTooLargeError'
  }
}
