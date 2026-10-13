import { MongoClient, ObjectId } from 'mongodb'

import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FeedbackEntity } from '../entities/feedback.entity'
import { FeedbackRepository } from './feedback.repository'

describe(FeedbackRepository.name, () => {
  let feedbackRepository: FeedbackRepository
  let mongod: MongoMemoryServer

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()

    const database = new MongoClient(mongod.getUri()).db('pdf_studio_test')

    feedbackRepository = new FeedbackRepository(database)
  })

  afterAll(async () => {
    await mongod!.stop()
  })

  it('should create a feedback', async () => {
    const returned = await feedbackRepository.create(new FeedbackEntity({
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
