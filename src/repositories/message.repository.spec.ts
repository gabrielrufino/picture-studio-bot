import type { Db, MongoClient } from 'mongodb'
import { ObjectId } from 'mongodb'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MessageEntity } from '@/entities/message.entity'
import { connectToTestDatabase } from '@/test/mongodb'
import { MessageRepository } from './message.repository'

describe(MessageRepository.name, () => {
  let messageRepository: MessageRepository
  let client: MongoClient
  let database: Db

  beforeAll(async () => {
    ({ client, database } = await connectToTestDatabase('message'))

    messageRepository = new MessageRepository(database)
  })

  afterAll(async () => {
    await client.close()
  })

  it('should create a message', async () => {
    const returned = await messageRepository.create(new MessageEntity({
      telegram_user: { id: 1, is_bot: false, first_name: 'Test' },
      text: 'Hello, world!',
    }))

    expect(returned).toEqual({
      _id: expect.any(ObjectId),
      telegram_user: { id: 1, is_bot: false, first_name: 'Test' },
      text: 'Hello, world!',
      created_at: expect.any(Date),
      updated_at: expect.any(Date),
    })
  })
})
