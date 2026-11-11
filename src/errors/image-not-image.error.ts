export class ImageNotImageError extends Error {
  constructor() {
    super('The downloaded resource is not a valid image.')
    this.name = 'ImageNotImageError'
  }
}
