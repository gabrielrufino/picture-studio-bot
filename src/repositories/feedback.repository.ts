import type { Db } from 'mongodb'
import type { FeedbackEntity } from '../entities/feedback.entity'
import { BaseRepository } from './base.repository'

export class FeedbackRepository extends BaseRepository<FeedbackEntity> {
  constructor(database: Db) {
    super({
      collectionName: 'feedbacks',
      database,
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['telegram_user', 'text', 'created_at'],
          properties: {
            telegram_user: {
              bsonType: 'object',
            },
            text: {
              bsonType: 'string',
            },
            created_at: {
              bsonType: 'date',
            },
          } as Record<keyof FeedbackEntity, any>,
        },
      },
    })
  }
}
