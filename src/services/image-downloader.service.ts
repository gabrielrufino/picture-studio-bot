import type { LookupFunction } from 'node:net'
import type { Response } from 'undici'
import { Buffer } from 'node:buffer'
import dns from 'node:dns/promises'
import ipaddr from 'ipaddr.js'
import sharp from 'sharp'
import { Agent, fetch } from 'undici'
import { MAX_PRO_FILE_SIZE } from '@/config/constants'
import { ImageFetchError, ImageInvalidUrlError, ImageNotImageError, ImageSsrfBlockError, ImageTooLargeError, ImageTooManyRedirectsError } from '@/errors'

export interface ImageInfo {
  format: string
  width?: number
  height?: number
  channels?: number
  colorSpace?: string
  sizeBytes: number
}

const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
])

const ascii = (text: string): number[] => [...text].map(char => char.charCodeAt(0))

const IMAGE_SIGNATURES: ReadonlyArray<{ offset: number, sig: readonly number[] }> = [
  {
    offset: 0,
    sig: [0xFF, 0xD8, 0xFF],
  },
  {
    offset: 0,
    sig: [0x89, 0x50, 0x4E, 0x47],
  },
  {
    offset: 8,
    sig: ascii('WEBP'),
  },
  {
    offset: 0,
    sig: ascii('GIF8'),
  },
  {
    offset: 0,
    sig: [0x49, 0x49, 0x2A, 0x00],
  },
  {
    offset: 0,
    sig: [0x4D, 0x4D, 0x00, 0x2A],
  },
  {
    offset: 4,
    sig: ascii('ftypavif'),
  },
  {
    offset: 4,
    sig: ascii('ftypavis'),
  },
]

const REDIRECT_STATUSES = [301, 302, 303, 307, 308]
const MAX_REDIRECTS = 5
const FETCH_TIMEOUT_MS = 30_000

export class ImageDownloaderService {
  private readonly dispatcher = new Agent({
    connect: {
      lookup: (hostname, options, callback) => this.lookupPublicAddress(hostname, options, callback),
    },
  })

  public async downloadAndAnalyze(url: string, maxBytes = MAX_PRO_FILE_SIZE): Promise<ImageInfo & { buffer: Buffer }> {
    if (!this.isValidUrl(url)) {
      throw new ImageInvalidUrlError()
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const response = await this.fetchWithChecks(url, controller.signal, maxBytes)

      if (!this.isSupportedContentType(response.headers.get('content-type'))) {
        await response.body?.cancel()
        throw new ImageNotImageError()
      }

      if (!response.body) {
        throw new ImageFetchError()
      }

      const buffer = await this.readBody(response.body, maxBytes)
      this.assertImageSignature(buffer)

      const meta = await sharp(buffer).metadata().catch(() => {
        throw new ImageNotImageError()
      })

      if (!meta.format) {
        throw new ImageNotImageError()
      }

      return {
        // sharp reports AVIF as "heif"; the AVIF signature check above guarantees the container is AVIF here
        format: (meta.format === 'heif'
          ? 'avif'
          : meta.format).toUpperCase(),
        width: meta.width,
        height: meta.height,
        channels: meta.channels,
        colorSpace: meta.space,
        sizeBytes: buffer.byteLength,
        buffer,
      }
    }
    finally {
      clearTimeout(timeoutId)
    }
  }

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    }
    catch {
      return false
    }
  }

  private isSupportedContentType(contentType: string | null): boolean {
    const mimeType = (contentType ?? '').split(';')[0].trim().toLowerCase()
    return SUPPORTED_MIME_TYPES.has(mimeType)
  }

  private async readBody(body: NonNullable<Response['body']>, maxBytes: number): Promise<Buffer> {
    const chunks: Uint8Array[] = []
    let total = 0

    try {
      for await (const chunk of body) {
        total += chunk.byteLength
        if (total > maxBytes) {
          throw new ImageTooLargeError()
        }
        chunks.push(chunk)
      }
    }
    catch (error) {
      if (error instanceof ImageTooLargeError) {
        throw error
      }
      throw new ImageFetchError()
    }

    return Buffer.concat(chunks)
  }

  private async fetchWithChecks(url: string, signal: AbortSignal, maxBytes: number): Promise<Response> {
    let currentUrl = url
    let redirects = 0

    while (true) {
      this.assertPublicHost(currentUrl)

      const response = await fetch(currentUrl, {
        redirect: 'manual',
        signal,
        dispatcher: this.dispatcher,
      }).catch((error: unknown) => {
        throw this.toFetchError(error)
      })

      if (!REDIRECT_STATUSES.includes(response.status)) {
        if (response.status !== 200) {
          await response.body?.cancel()
          throw new ImageFetchError()
        }

        const contentLength = Number(response.headers.get('content-length'))
        if (contentLength > maxBytes) {
          throw new ImageTooLargeError()
        }

        return response
      }

      await response.body?.cancel()

      const location = response.headers.get('location')
      if (!location) {
        throw new ImageFetchError()
      }

      if (redirects >= MAX_REDIRECTS) {
        throw new ImageTooManyRedirectsError()
      }

      redirects++
      currentUrl = new URL(location, currentUrl).href
      if (!this.isValidUrl(currentUrl)) {
        throw new ImageInvalidUrlError()
      }
    }
  }

  private assertPublicHost(url: string): void {
    const hostname = this.extractHostname(url)
    if (!hostname) {
      throw new ImageSsrfBlockError()
    }

    if (ipaddr.isValid(hostname) && this.isIpBlocked(hostname)) {
      throw new ImageSsrfBlockError()
    }
  }

  private readonly lookupPublicAddress: LookupFunction = (hostname, options, callback) => {
    dns.lookup(hostname, { all: true, family: options.family }).then(
      (addresses) => {
        if (addresses.some(({ address }) => this.isIpBlocked(address))) {
          callback(new ImageSsrfBlockError(), '', 0)
          return
        }
        if (options.all) {
          callback(null, addresses)
          return
        }
        callback(null, addresses[0].address, addresses[0].family)
      },
      error => callback(error, '', 0),
    )
  }

  private toFetchError(error: unknown): Error {
    return this.findSsrfBlock(error) ?? new ImageFetchError()
  }

  private findSsrfBlock(error: unknown): ImageSsrfBlockError | undefined {
    if (error instanceof ImageSsrfBlockError) {
      return error
    }
    if (typeof error !== 'object' || error === null) {
      return undefined
    }
    const { cause, errors } = error as { cause?: unknown, errors?: unknown }
    const candidates = [
      cause,
      ...(Array.isArray(errors)
        ? errors
        : []),
    ]
    for (const candidate of candidates) {
      const found = this.findSsrfBlock(candidate)
      if (found) {
        return found
      }
    }
    return undefined
  }

  private extractHostname(url: string): string {
    try {
      return new URL(url).hostname.replace(/^\[(.*)\]$/, '$1')
    }
    catch {
      return ''
    }
  }

  private isIpBlocked(address: string): boolean {
    try {
      return ipaddr.parse(address).range() !== 'unicast'
    }
    catch {
      return true
    }
  }

  private assertImageSignature(buffer: Buffer): void {
    const matches = IMAGE_SIGNATURES.some(({ offset, sig }) => this.matchSignature(buffer, sig, offset))
    if (!matches) {
      throw new ImageNotImageError()
    }
  }

  private matchSignature(buffer: Buffer, signature: readonly number[], offset = 0): boolean {
    if (buffer.length < offset + signature.length) {
      return false
    }
    return signature.every((byte, i) => buffer[offset + i] === byte)
  }
}
