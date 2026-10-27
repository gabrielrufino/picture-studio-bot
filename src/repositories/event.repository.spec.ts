import type { Db, MongoClient } from 'mongodb'
import { MongoServerError } from 'mongodb'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EventEntity } from '@/entities/event.entity'
import { EventEnum } from '@/enums/event.enum'
import { connectToTestDatabase } from '@/test/mongodb'
import { EventRepository } from './event.repository'

describe(EventRepository.name, () => {
  let eventRepository: EventRepository
  let client: MongoClient
  let database: Db

  beforeAll(async () => {
    ({ client, database } = await connectToTestDatabase('event'))

    eventRepository = new EventRepository(database)
    await eventRepository.init()
  })

  afterAll(async () => {
    await client.close()
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
