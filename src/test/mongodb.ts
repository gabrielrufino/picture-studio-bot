import type { Db } from 'mongodb'
import process from 'node:process'
import { MongoClient } from 'mongodb'

interface TestDatabase {
  client: MongoClient
  database: Db
}

export async function connectToTestDatabase(name: string): Promise<TestDatabase> {
  const uri = process.env.MONGODB_CONNECTION_STRING

  if (!uri) {
    throw new Error('MONGODB_CONNECTION_STRING is not set. Check the Vitest global setup.')
  }

  const client = new MongoClient(uri)
  await client.connect()

  const databaseName = `pdf_studio_test_${name}`
  await client.db(databaseName).dropDatabase().catch(() => {})

  return { client, database: client.db(databaseName) }
}
