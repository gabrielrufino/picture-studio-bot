import { MongoClient, ObjectId } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MessageEntity } from '../entities/message.entity'
import { MessageRepository } from './message.repository'

describe(MessageRepository.name, () => {
  let messageRepository: MessageRepository
  let mongod: MongoMemoryServer

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()

    const database = new MongoClient(mongod.getUri())
      .db('pdf_studio_test')

    messageRepository = new MessageRepository(database)
  })

  afterAll(async () => {
    await mongod!.stop()
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
