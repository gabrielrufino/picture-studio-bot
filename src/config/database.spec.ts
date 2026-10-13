import { describe, expect, it, vi } from 'vitest'

describe('database config', () => {
  it('should throw if MONGODB_CONNECTION_STRING is not set', async () => {
    vi.stubEnv('MONGODB_CONNECTION_STRING', '')
    try {
      await expect(import(`./database?throw=${Date.now()}`)).rejects.toThrow('MONGODB_CONNECTION_STRING is not set')
    }
    finally {
      vi.unstubAllEnvs()
    }
  })

  it('should initialize MongoClient if connectionString is set', async () => {
    vi.stubEnv('MONGODB_CONNECTION_STRING', 'mongodb://localhost:27017')
    try {
      const { mongoClient } = await import(`./database?ok=${Date.now()}`)
      expect(mongoClient).toBeDefined()
    }
    finally {
      vi.unstubAllEnvs()
    }
  })
})
