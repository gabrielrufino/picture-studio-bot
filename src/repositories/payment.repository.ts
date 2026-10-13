import type { Db } from 'mongodb'
import type { PaymentEntity } from '../entities/payment.entity'
import { CurrencyEnum } from '../enums/currency.enum'
import { BaseRepository } from './base.repository'

export class PaymentRepository extends BaseRepository<PaymentEntity> {
  constructor(database: Db) {
    super({
      collectionName: 'payments',
      database,
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['user_id', 'amount', 'currency', 'created_at', 'updated_at'],
          properties: {
            user_id: {
              bsonType: 'objectId',
            },
            amount: {
              bsonType: 'int',
            },
            currency: {
              bsonType: 'string',
              enum: Object.values(CurrencyEnum),
            },
            created_at: {
              bsonType: 'date',
            },
            updated_at: {
              bsonType: 'date',
            },
          },
        },
      },
      indexes: ['user_id'],
    })
  }
}
