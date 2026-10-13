import type { ObjectId } from 'mongodb'

export abstract class BaseEntity {
  declare _id: ObjectId

  created_at: Date = new Date()

  updated_at: Date = new Date()

  protected assign(input?: Record<string, unknown>) {
    Object.assign(this, input)
  }
}
