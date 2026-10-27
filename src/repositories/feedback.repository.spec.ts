import type { Db, MongoClient } from 'mongodb'
import { ObjectId } from 'mongodb'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FeedbackEntity } from '@/entities/feedback.entity'
import { connectToTestDatabase } from '@/test/mongodb'
import { FeedbackRepository } from './feedback.repository'

describe(FeedbackRepository.name, () => {
  let feedbackRepository: FeedbackRepository
  let client: MongoClient
  let database: Db

  beforeAll(async () => {
    ({ client, database } = await connectToTestDatabase('feedback'))

    feedbackRepository = new FeedbackRepository(database)
  })

  afterAll(async () => {
    await client.close()
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
