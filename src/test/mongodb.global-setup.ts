import process from 'node:process'
import { MongoMemoryServer } from 'mongodb-memory-server'

export async function setup(): Promise<() => Promise<void>> {
  const mongod = await MongoMemoryServer.create()

  process.env.MONGODB_CONNECTION_STRING = mongod.getUri()

  return async () => {
    await mongod.stop()
  }
}
