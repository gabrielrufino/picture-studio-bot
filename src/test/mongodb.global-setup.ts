import process from 'node:process'
import { MongoMemoryServer } from 'mongodb-memory-server'

let instance: MongoMemoryServer | undefined

export async function setup(): Promise<() => Promise<void>> {
  // Skip if MongoDB is already configured (e.g., CI or local Docker)
  if (process.env.MONGODB_CONNECTION_STRING) {
    return async () => {}
  }

  instance = await MongoMemoryServer.create()
  process.env.MONGODB_CONNECTION_STRING = instance.getUri()

  return async () => {
    if (instance) {
      await instance.stop()
      instance = undefined
    }
  }
}
