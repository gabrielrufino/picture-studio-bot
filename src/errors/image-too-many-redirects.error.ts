export class ImageTooManyRedirectsError extends Error {
  constructor() {
    super('Too many redirects.')
    this.name = 'ImageTooManyRedirectsError'
  }
}
