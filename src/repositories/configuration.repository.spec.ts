import type { Db, MongoClient } from 'mongodb'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { connectToTestDatabase } from '@/test/mongodb'
import { ConfigurationRepository } from './configuration.repository'

describe(ConfigurationRepository.name, () => {
  let configurationRepository: ConfigurationRepository
  let client: MongoClient
  let database: Db

  beforeAll(async () => {
    ({ client, database } = await connectToTestDatabase('configuration'))
    configurationRepository = new ConfigurationRepository(database)
    await configurationRepository.init()
  })

  afterAll(async () => {
    await client.close()
  })

  describe(ConfigurationRepository.prototype.findGlobalConfig.name, () => {
    beforeAll(() => {
      vi.useFakeTimers()
    })

    afterAll(() => {
      vi.useRealTimers()
    })

    it('should return the global_config document after init', async () => {
      const result = await configurationRepository.findGlobalConfig()

      expect(result).toMatchObject({
        _id: 'global_config',
        pro_price: 350,
        maintenance_mode: false,
      })
    })

    it('should not create a duplicate document when init is called again', async () => {
      await configurationRepository.init()

      const docs = await database
        .collection('configurations')
        .find({ _id: 'global_config' } as any)
        .toArray()

      expect(docs).toHaveLength(1)
    })

    it('should migrate existing configuration missing maintenance fields', async () => {
      const db = database
      const coll = db.collection('configurations')

      // Remove the validator temporarily to insert an incomplete document
      await db.command({ collMod: 'configurations', validator: {} })

      await coll.deleteOne({ _id: 'global_config' } as any)
      await coll.insertOne({
        _id: 'global_config',
        pro_price: 400,
        created_at: new Date(),
        updated_at: new Date(),
      } as any)

      // Re-apply validator via init
      await configurationRepository.init()

      const result = await configurationRepository.findGlobalConfig()
      expect(result).toMatchObject({
        _id: 'global_config',
        pro_price: 400,
        maintenance_mode: false,
      })
    })

    it('should use cached config within TTL and not query DB again', async () => {
      configurationRepository.clearCache()

      // Need to spy on the collection's findOne method via prototype or the instance
      const findSpy = vi.spyOn((configurationRepository as any).collection, 'findOne')

      await configurationRepository.findGlobalConfig()
      await configurationRepository.findGlobalConfig()

      expect(findSpy).toHaveBeenCalledTimes(1)

      findSpy.mockRestore()
    })

    it('should refresh cache after TTL expires', async () => {
      configurationRepository.clearCache()

      const findSpy = vi.spyOn((configurationRepository as any).collection, 'findOne')

      await configurationRepository.findGlobalConfig()
      vi.advanceTimersByTime(31_000)
      await configurationRepository.findGlobalConfig()

      expect(findSpy).toHaveBeenCalledTimes(2)

      findSpy.mockRestore()
    })

    it('should respect clearCache and re-fetch', async () => {
      configurationRepository.clearCache()

      const findSpy = vi.spyOn((configurationRepository as any).collection, 'findOne')

      await configurationRepository.findGlobalConfig()
      configurationRepository.clearCache()
      await configurationRepository.findGlobalConfig()

      expect(findSpy).toHaveBeenCalledTimes(2)

      findSpy.mockRestore()
    })
  })

  it('should enforce schema — reject document missing required fields', async () => {
    const db = database

    await expect(
      db.collection('configurations').insertOne({
        _id: 'bad_doc',
        created_at: new Date(),
        updated_at: new Date(),
      } as any),
    ).rejects.toThrow()
  })

  it('should enforce schema — reject pro_price <= 0', async () => {
    const db = database

    await expect(
      db.collection('configurations').insertOne({
        _id: 'bad_price_doc',
        pro_price: 0,
        created_at: new Date(),
        updated_at: new Date(),
      } as any),
    ).rejects.toThrow()
  })
})
