import type { Db, MongoClient } from 'mongodb'
import { ObjectId } from 'mongodb'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PaymentEntity } from '@/entities/payment.entity'
import { CurrencyEnum } from '@/enums/currency.enum'
import { connectToTestDatabase } from '@/test/mongodb'
import { PaymentRepository } from './payment.repository'

describe(PaymentRepository.name, () => {
  let paymentRepository: PaymentRepository
  let client: MongoClient
  let database: Db

  beforeAll(async () => {
    ({ client, database } = await connectToTestDatabase('payment'))
    paymentRepository = new PaymentRepository(database)
  })

  afterAll(async () => {
    await client.close()
  })

  it('should create a payment', async () => {
    const userId = new ObjectId()
    const payment = new PaymentEntity({
      user_id: userId,
      amount: 100,
      currency: CurrencyEnum.XTR,
    })

    const created = await paymentRepository.create(payment)

    expect(created).toMatchObject({
      _id: expect.any(ObjectId),
      user_id: userId,
      amount: 100,
      currency: CurrencyEnum.XTR,
      created_at: expect.any(Date),
      updated_at: expect.any(Date),
    })
  })

  it('should create the correct indexes', async () => {
    const userId = new ObjectId()
    await paymentRepository.create(new PaymentEntity({
      user_id: userId,
      amount: 50,
      currency: CurrencyEnum.XTR,
    }))

    const indexes = await database.collection('payments').indexes()
    expect(indexes.some(idx => idx.key.user_id === 1)).toBe(true)
  })

  it('should enforce schema — reject invalid currency', async () => {
    const userId = new ObjectId()

    // Ensure collection is initialized
    await paymentRepository.create(new PaymentEntity({
      user_id: userId,
      amount: 10,
      currency: CurrencyEnum.XTR,
    }))

    await expect(
      database.collection('payments').insertOne({
        user_id: userId,
        amount: 10,
        currency: 'INVALID',
        created_at: new Date(),
        updated_at: new Date(),
      }),
    ).rejects.toThrow()
  })
})
