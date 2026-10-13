import process from 'node:process'
import { MongoClient } from 'mongodb'

const connectionString = process.env.MONGODB_CONNECTION_STRING

if (!connectionString) {
  throw new Error('MONGODB_CONNECTION_STRING is not set')
}

export const mongoClient = new MongoClient(connectionString)
export const database = mongoClient.db('picture_studio')
