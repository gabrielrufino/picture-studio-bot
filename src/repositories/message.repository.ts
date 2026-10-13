import type { Db } from 'mongodb'
import type { MessageEntity } from '../entities/message.entity'
import { BaseRepository } from './base.repository'

export class MessageRepository extends BaseRepository<MessageEntity> {
  constructor(database: Db) {
    super({
      collectionName: 'messages',
      database,
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['telegram_user', 'text', 'created_at', 'updated_at'],
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
            updated_at: {
              bsonType: 'date',
            },
          } as Record<keyof MessageEntity, any>,
        },
      },
      indexes: ['telegram_user.id', 'created_at'],
    })
  }
}
