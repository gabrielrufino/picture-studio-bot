import type { Db } from 'mongodb'
import crypto from 'node:crypto'
import process from 'node:process'
import { MongoClient } from 'mongodb'

interface TestDatabase {
  client: MongoClient
  database: Db
}

let __runId: string | undefined

export async function connectToTestDatabase(name: string): Promise<TestDatabase> {
  if (!__runId) {
    __runId = crypto.randomUUID().slice(0, 8)
  }

  const uri = process.env.MONGODB_CONNECTION_STRING

  if (!uri) {
    throw new Error('MONGODB_CONNECTION_STRING is not set. Check the Vitest global setup.')
  }

  const client = new MongoClient(uri)
  await client.connect()

  const databaseName = `pdf_studio_test_${name}_${__runId}`
  await client.db(databaseName).dropDatabase()

  return { client, database: client.db(databaseName) }
}
