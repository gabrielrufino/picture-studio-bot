import type { Db } from 'mongodb'
import type { EventEntity } from '../entities/event.entity'
import { EventEnum } from '../enums/event.enum'
import { BaseRepository } from './base.repository'

export class EventRepository extends BaseRepository<EventEntity> {
  constructor(database: Db) {
    super({
      collectionName: 'events',
      database,
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['event', 'telegram_user', 'created_at', 'updated_at'],
          properties: {
            event: {
              enum: Object.values(EventEnum),
            },
            telegram_user: {
              bsonType: 'object',
            },
            metadata: {
              bsonType: 'object',
            },
            created_at: {
              bsonType: 'date',
            },
            updated_at: {
              bsonType: 'date',
            },
          } as Record<keyof EventEntity, any>,
        },
      },
      indexes: ['telegram_user.id', 'created_at'],
    })
  }
}
