import { Buffer } from 'node:buffer'
import dns from 'node:dns/promises'

import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ImageFetchError, ImageInvalidUrlError, ImageNotImageError, ImageSsrfBlockError, ImageTooLargeError } from '@/errors'
import { ImageDownloaderService } from '@/services/image-downloader.service'

vi.mock('node:dns/promises', () => ({
  default: {
    lookup: vi.fn(),
  },
}))

vi.mock('undici', async importOriginal => ({
  ...await importOriginal<typeof import('undici')>(),
  fetch: (url: string, init?: RequestInit) => globalThis.fetch(url, init),
}))

// Mock sharp BEFORE importing anything that uses it
vi.mock('sharp', () => ({
  default: vi.fn().mockImplementation((_data?: unknown) => ({
    metadata: vi.fn().mockResolvedValue({
      format: 'jpeg',
      width: 100,
      height: 100,
      channels: 3,
    }),
  })),
}))

const JPEG_MAGIC = Buffer.from([
  0xFF,
  0xD8,
  0xFF,
  0xE0,
  0x00,
  0x10,
  0x4A,
  0x46,
  0x49,
  0x46,
])
const PNG_MAGIC = Buffer.from([
  0x89,
  0x50,
  0x4E,
  0x47,
  0x0D,
  0x0A,
  0x1A,
  0x0A,
])
const WEBP_MAGIC = Buffer.from([
  0x52,
  0x49,
  0x46,
  0x46,
  0x00,
  0x00,
  0x00,
  0x00,
  0x57,
  0x45,
  0x42,
  0x50,
])
const AVIF_MAGIC = Buffer.concat([
  Buffer.alloc(4),
  Buffer.from('ftypavif'),
])
const GIF_MAGIC = Buffer.from([
  0x47,
  0x49,
  0x46,
  0x38,
  0x39,
  0x61,
  0x01,
  0x00,
])
const TIFF_MAGIC_LE = Buffer.from([
  0x49,
  0x49,
  0x2A,
  0x00,
  0x08,
  0x00,
  0x00,
  0x00,
])
const TIFF_MAGIC_BE = Buffer.from([
  0x4D,
  0x4D,
  0x00,
  0x2A,
  0x00,
  0x08,
  0x00,
  0x00,
])

describe(ImageDownloaderService.name, () => {
  let service: ImageDownloaderService

  beforeEach(() => {
    service = new ImageDownloaderService()
    vi.clearAllMocks()
    vi.restoreAllMocks()
    // Reset sharp mock to return jpeg by default (service passes buffer → sharp returns meta)
    vi.resetModules()
    vi.mocked(dns.lookup).mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as any)
  })

  function createMockFetch(status: number, headers: Record<string, string>, body?: Uint8Array[]) {
    const mockResponse = {
      status,
      headers: {
        get: (key: string) => headers[key.toLowerCase()] ?? null,
      },
      body: {
        cancel: vi.fn().mockResolvedValue(undefined),
        async* [Symbol.asyncIterator]() {
          for (const chunk of body ?? []) yield chunk
        },
      },
    }
    return vi.fn().mockResolvedValue(mockResponse)
  }

  describe(ImageDownloaderService.prototype.downloadAndAnalyze.name, () => {
    it.each([
      ['JPEG', JPEG_MAGIC],
      ['PNG', PNG_MAGIC],
      ['WebP', WEBP_MAGIC],
      ['GIF', GIF_MAGIC],
      ['TIFF-LE', TIFF_MAGIC_LE],
      ['TIFF-BE', TIFF_MAGIC_BE],
    ])('should download a valid image and return info', async (_, magic) => {
      vi.stubGlobal('fetch', createMockFetch(200, { 'content-type': 'image/jpeg' }, [magic]))

      const result = await service.downloadAndAnalyze('https://example.com/image')

      expect(result.width).toBeDefined()
      expect(result.sizeBytes).toBe(magic.byteLength)
    })

    it('should report AVIF when sharp reports the container as heif', async () => {
      vi.mocked(sharp).mockImplementationOnce(() => ({
        metadata: vi.fn().mockResolvedValue({
          format: 'heif',
          width: 100,
          height: 100,
          channels: 4,
        }),
      }) as any)
      vi.stubGlobal('fetch', createMockFetch(200, { 'content-type': 'image/avif' }, [AVIF_MAGIC]))

      const result = await service.downloadAndAnalyze('https://example.com/image.avif')

      expect(result.format).toBe('AVIF')
    })

    it('should throw ImageInvalidUrlError for non-http schemes', async () => {
      await expect(service.downloadAndAnalyze('file:///tmp/image.jpg')).rejects.toThrow(ImageInvalidUrlError)
      await expect(service.downloadAndAnalyze('data:image/png;base64,abc')).rejects.toThrow(ImageInvalidUrlError)
    })

    it('should throw ImageInvalidUrlError for malformed URLs', async () => {
      await expect(service.downloadAndAnalyze('not-a-url')).rejects.toThrow(ImageInvalidUrlError)
      await expect(service.downloadAndAnalyze('')).rejects.toThrow(ImageInvalidUrlError)
    })

    it('should throw ImageSsrfBlockError when redirect target is private IP', async () => {
      const originalFetch = globalThis.fetch
      let callCount = 0
      vi.stubGlobal('fetch', async (url: string) => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            status: 302,
            headers: {
              get: (k: string) => k === 'location'
                ? 'http://192.168.1.1/img.jpg'
                : null,
            },
            body: {
              cancel: vi.fn().mockResolvedValue(undefined),
            },
          })
        }
        return (originalFetch as typeof fetch)(url)
      })

      await expect(service.downloadAndAnalyze('https://example.com/img.jpg')).rejects.toThrow(ImageSsrfBlockError)
      globalThis.fetch = originalFetch
    })

    it('should throw ImageNotImageError when content-type is not an image', async () => {
      vi.stubGlobal('fetch', createMockFetch(200, { 'content-type': 'application/json' }))

      await expect(service.downloadAndAnalyze('https://example.com/file.json')).rejects.toThrow(ImageNotImageError)
    })

    it('should cancel the response body when the content-type is not an image', async () => {
      const cancel = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        status: 200,
        headers: {
          get: (key: string) => key === 'content-type'
            ? 'application/json'
            : null,
        },
        body: {
          cancel,
          async* [Symbol.asyncIterator]() {},
        },
      }))

      await expect(service.downloadAndAnalyze('https://example.com/file.json')).rejects.toThrow(ImageNotImageError)
      expect(cancel).toHaveBeenCalledOnce()
    })

    it('should throw ImageNotImageError for PDF content-type', async () => {
      vi.stubGlobal('fetch', createMockFetch(200, { 'content-type': 'application/pdf' }))

      await expect(service.downloadAndAnalyze('https://example.com/file.pdf')).rejects.toThrow(ImageNotImageError)
    })

    it('should reject when fetch throws', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

      await expect(service.downloadAndAnalyze('https://example.com/img.jpg')).rejects.toThrow()
    })

    it.each([
      'http://127.0.0.1/img.jpg',
      'http://[::1]/img.jpg',
      'http://169.254.169.254/latest/meta-data',
    ])('should block private initial target %s without fetching', async (url) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      await expect(service.downloadAndAnalyze(url)).rejects.toThrow(ImageSsrfBlockError)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('should map a connection blocked by the lookup to ImageSsrfBlockError', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed', {
        cause: new ImageSsrfBlockError(),
      })))

      await expect(service.downloadAndAnalyze('https://internal.example.com/img.jpg')).rejects.toThrow(ImageSsrfBlockError)
    })

    it('should reject when hostname cannot be resolved', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed', {
        cause: new Error('ENOTFOUND'),
      })))

      await expect(service.downloadAndAnalyze('https://missing.example.com/img.jpg')).rejects.toThrow(ImageFetchError)
    })

    it('should send requests through the connect-time lookup dispatcher', async () => {
      const fetchMock = createMockFetch(200, { 'content-type': 'image/jpeg' }, [JPEG_MAGIC])
      vi.stubGlobal('fetch', fetchMock)

      await service.downloadAndAnalyze('https://example.com/image')

      expect(fetchMock).toHaveBeenCalledWith('https://example.com/image', expect.objectContaining({
        redirect: 'manual',
        dispatcher: (service as any).dispatcher,
      }))
    })

    it('should throw ImageNotImageError when body bytes do not match any image signature', async () => {
      vi.stubGlobal('fetch', createMockFetch(200, { 'content-type': 'image/png' }, [
        Buffer.from('<html>not an image</html>'),
      ]))

      await expect(service.downloadAndAnalyze('https://example.com/img.png')).rejects.toThrow(ImageNotImageError)
    })

    it('should throw ImageTooLargeError when streamed body exceeds the limit without content-length', async () => {
      const half = Buffer.alloc(26 * 1024 * 1024)
      vi.stubGlobal('fetch', createMockFetch(200, { 'content-type': 'image/jpeg' }, [half, half]))

      await expect(service.downloadAndAnalyze('https://example.com/img.jpg')).rejects.toThrow(ImageTooLargeError)
    })
  })

  describe('extractHostname', () => {
    it('should extract hostname from URL', () => {
      // @ts-expect-error private method accessed in test
      expect(service.extractHostname('https://example.com/path?q=1')).toBe('example.com')
    })

    it('should return empty string for invalid URL', () => {
      // @ts-expect-error private method
      expect(service.extractHostname('not-a-url')).toBe('')
    })
  })

  describe('isIpBlocked', () => {
    it('should block private IPs', () => {
      expect((service as any).isIpBlocked('192.168.1.1')).toBe(true)
      expect((service as any).isIpBlocked('10.0.0.1')).toBe(true)
      expect((service as any).isIpBlocked('172.16.0.1')).toBe(true)
      expect((service as any).isIpBlocked('127.0.0.1')).toBe(true)
      expect((service as any).isIpBlocked('::1')).toBe(true)
    })

    it('should allow public IPs', () => {
      expect((service as any).isIpBlocked('8.8.8.8')).toBe(false)
      expect((service as any).isIpBlocked('1.1.1.1')).toBe(false)
    })

    it('should block values that are not parseable IP addresses', () => {
      expect((service as any).isIpBlocked('example.com')).toBe(true)
    })
  })

  describe('lookupPublicAddress', () => {
    function lookup(hostname: string, options: { all?: boolean, family?: number }) {
      return new Promise<{ err: unknown, address?: unknown, family?: number }>((resolve) => {
        (service as any).lookupPublicAddress(hostname, options, (err: unknown, address: unknown, family?: number) => {
          resolve({ err, address, family })
        })
      })
    }

    it('should return the resolved public address', async () => {
      const result = await lookup('example.com', { all: false })

      expect(result.err).toBeNull()
      expect(result.address).toBe('93.184.216.34')
      expect(result.family).toBe(4)
    })

    it('should return all addresses when requested', async () => {
      const addresses = [
        { address: '93.184.216.34', family: 4 },
      ]

      const result = await lookup('example.com', { all: true })

      expect(result.err).toBeNull()
      expect(result.address).toEqual(addresses)
    })

    it('should fail with ImageSsrfBlockError when any resolved address is private', async () => {
      vi.mocked(dns.lookup).mockResolvedValueOnce([
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ] as any)

      const result = await lookup('rebind.example.com', { all: false })

      expect(result.err).toBeInstanceOf(ImageSsrfBlockError)
    })

    it('should forward DNS errors', async () => {
      const dnsError = new Error('ENOTFOUND')
      vi.mocked(dns.lookup).mockRejectedValueOnce(dnsError)

      const result = await lookup('missing.example.com', { all: false })

      expect(result.err).toBe(dnsError)
    })
  })

  describe('matchSignature', () => {
    it('should match JPEG magic bytes', () => {
      // @ts-expect-error private method
      expect(service.matchSignature(JPEG_MAGIC, [0xFF, 0xD8])).toBe(true)
    })

    it('should match PNG magic bytes', () => {
      // @ts-expect-error private method
      expect(service.matchSignature(PNG_MAGIC, [0x89, 0x50, 0x4E, 0x47])).toBe(true)
    })

    it('should not match wrong signature', () => {
      // @ts-expect-error private method
      expect(service.matchSignature(Buffer.from([0x48, 0x54]), [0xFF, 0xD8])).toBe(false)
    })

    it('should return false for buffers shorter than signature', () => {
      // @ts-expect-error private method
      expect(service.matchSignature(Buffer.from([0xFF]), [0xFF, 0xD8, 0xFF])).toBe(false)
    })
  })
})
