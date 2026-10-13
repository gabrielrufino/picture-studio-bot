import { MongoClient, MongoServerError } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EventEntity } from '../entities/event.entity'
import { EventEnum } from '../enums/event.enum'
import { EventRepository } from './event.repository'

describe(EventRepository.name, () => {
  let eventRepository: EventRepository
  let mongod: MongoMemoryServer
  let client: MongoClient

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
    process.env.MONGODB_CONNECTION_STRING = mongod.getUri()
    client = new MongoClient(mongod.getUri())
    const database = client.db('pdf_studio_test')

    eventRepository = new EventRepository(database)
    await eventRepository.init()
  })

  afterAll(async () => {
    await client.close()
    await mongod.stop()
  })

  it('should insert event successfully', async () => {
    const returned = await eventRepository.create(new EventEntity({
      event: EventEnum.CommandStart,
      telegram_user: { id: 123, is_bot: false, first_name: 'John' },
    }))

    expect(returned).toBeDefined()
    expect(returned.event).toBe(EventEnum.CommandStart)
  })

  it('should fail schema validation if event is invalid', async () => {
    await expect(
      eventRepository.create(new EventEntity({
        event: 'invalid_event' as EventEnum,
        telegram_user: { id: 123, is_bot: false, first_name: 'John' },
      })),
    ).rejects.toThrowError(MongoServerError)
  })
})
