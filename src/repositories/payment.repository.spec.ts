import { MongoClient, ObjectId } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PaymentEntity } from '../entities/payment.entity'
import { CurrencyEnum } from '../enums/currency.enum'
import { PaymentRepository } from './payment.repository'

describe(PaymentRepository.name, () => {
  let paymentRepository: PaymentRepository
  let mongod: MongoMemoryServer
  let client: MongoClient

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
    client = new MongoClient(mongod.getUri())
    await client.connect()
    const database = client.db('pdf_studio_test')
    paymentRepository = new PaymentRepository(database)
  })

  afterAll(async () => {
    await client.close()
    await mongod.stop()
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

    const indexes = await client.db('pdf_studio_test').collection('payments').indexes()
    expect(indexes.some(idx => idx.key.user_id === 1)).toBe(true)
  })

  it('should enforce schema — reject invalid currency', async () => {
    const userId = new ObjectId()
    const db = client.db('pdf_studio_test')

    // Ensure collection is initialized
    await paymentRepository.create(new PaymentEntity({
      user_id: userId,
      amount: 10,
      currency: CurrencyEnum.XTR,
    }))

    await expect(
      db.collection('payments').insertOne({
        user_id: userId,
        amount: 10,
        currency: 'INVALID',
        created_at: new Date(),
        updated_at: new Date(),
      }),
    ).rejects.toThrow()
  })
})
