import { MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { BaseRepository } from './base.repository'

describe(BaseRepository.name, () => {
  let mongod: MongoMemoryServer
  let client: MongoClient

  class TestRepository extends BaseRepository<{ name: string, updated_at: Date }> {
    constructor(database: any) {
      super({
        collectionName: 'test',
        database,
        validator: { $jsonSchema: { bsonType: 'object', required: ['name'] } },
        indexes: ['name'],
      })
    }
  }

  class TestRepositoryNoIndexes extends BaseRepository<{ name: string, updated_at: Date }> {
    constructor(database: any) {
      super({
        collectionName: 'test',
        database,
        validator: { $jsonSchema: { bsonType: 'object', required: ['name'] } },
      })
    }
  }

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
    client = new MongoClient(mongod.getUri())
    await client.connect()
  })

  afterAll(async () => {
    await client.close()
    await mongod.stop()
  })

  it('should initialize correctly when collection does not exist', async () => {
    const db = client.db('test_db_1')
    const repo = new TestRepository(db)

    await repo.init()

    const collections = await db.listCollections({ name: 'test' }).toArray()
    expect(collections.length).toBe(1)
    expect((repo as any).initialized).toBe(true)
  })

  it('should initialize correctly when collection already exists', async () => {
    const db = client.db('test_db_2')
    await db.createCollection('test')
    const repo = new TestRepository(db)

    await repo.init()

    const collections = await db.listCollections({ name: 'test' }).toArray()
    expect(collections.length).toBe(1)
    expect((repo as any).initialized).toBe(true)
  })

  it('should call init automatically when calling a decorated method', async () => {
    const db = client.db('test_db_3')
    const repo = new TestRepository(db)
    const initSpy = vi.spyOn(repo, 'init')

    await repo.create({ name: 'test', updated_at: new Date() })

    expect(initSpy).toHaveBeenCalled()
    expect((repo as any).initialized).toBe(true)
  })

  it('should not call init again if already initialized', async () => {
    const db = client.db('test_db_4')
    const repo = new TestRepository(db)
    await repo.init()
    const initSpy = vi.spyOn(repo, 'init')

    await repo.create({ name: 'test', updated_at: new Date() })

    expect(initSpy).not.toHaveBeenCalled()
  })

  it('should update an entity by id', async () => {
    const db = client.db('test_db_5')
    const repo = new TestRepository(db)
    const entity = { name: 'initial', updated_at: new Date(0) }
    const created = await repo.create(entity)

    const updated = await repo.updateById((created as any)._id, { name: 'updated' })

    expect(updated).toBeDefined()
    expect(updated?.name).toBe('updated')
    expect(updated?.updated_at.getTime()).toBeGreaterThan(0)

    const found = await db.collection('test').findOne({ _id: (created as any)._id })
    expect(found?.name).toBe('updated')
  })

  it('should insert multiple entities', async () => {
    const db = client.db('test_db_6')
    const repo = new TestRepository(db)
    const entities = [
      { name: 'entity1', updated_at: new Date() },
      { name: 'entity2', updated_at: new Date() },
    ]

    const created = await repo.insertMany(entities)

    expect(created.length).toBe(2)
    expect((created[0] as any)?._id).toBeDefined()
    expect((created[1] as any)?._id).toBeDefined()
  })

  it('should return empty array if no entities are passed to insertMany', async () => {
    const db = client.db('test_db_7')
    const repo = new TestRepository(db)

    const created = await repo.insertMany([])

    expect(created).toEqual([])
  })

  it('should call createIndexes with all indexes on init', async () => {
    const db = client.db('test_db_8')
    const repo = new TestRepository(db)
    const createIndexesSpy = vi.spyOn((repo as any).collection, 'createIndexes')

    await repo.init()

    expect(createIndexesSpy).toHaveBeenCalledOnce()
    expect(createIndexesSpy).toHaveBeenCalledWith([{ key: { name: 1 } }])
  })

  it('should not call createIndexes when no indexes are defined', async () => {
    const db = client.db('test_db_9')
    const repo = new TestRepositoryNoIndexes(db)
    const createIndexesSpy = vi.spyOn((repo as any).collection, 'createIndexes')

    await repo.init()

    expect(createIndexesSpy).not.toHaveBeenCalled()
  })
})
