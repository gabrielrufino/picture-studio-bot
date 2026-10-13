import type { Collection, CreateCollectionOptions, Db, Document, ObjectId } from 'mongodb'
import { EnsureInitialized } from '../decorators/ensure-initialized.decorator'

export abstract class BaseRepository<T extends Document & { updated_at: Date }> {
  private readonly database: Db
  private readonly validator: CreateCollectionOptions['validator']
  private readonly indexes: Array<keyof T | string>
  protected initialized = false

  protected readonly collection: Collection<T>

  constructor(params: {
    collectionName: string
    database: Db
    validator: CreateCollectionOptions['validator']
    indexes?: Array<keyof T | string>
  }) {
    this.database = params.database
    this.collection = params.database.collection(params.collectionName)
    this.validator = params.validator
    this.indexes = params.indexes || []
  }

  public async init(): Promise<void> {
    const collections = await this.database.listCollections({ name: this.collection.collectionName }).toArray()
    const collectionExists = collections.length > 0

    if (!collectionExists) {
      await this.database.createCollection(this.collection.collectionName)
    }

    await this.database.command({
      collMod: this.collection.collectionName,
      validator: this.validator,
    })

    if (this.indexes.length > 0) {
      await this.collection.createIndexes(
        this.indexes.map(index => ({ key: { [index as string]: 1 } })),
      )
    }

    this.initialized = true
  }

  @EnsureInitialized
  public async create(entity: T): Promise<T> {
    const result = await this.collection.insertOne(entity as any)
    return { ...entity, _id: result.insertedId }
  }

  @EnsureInitialized
  public async insertMany(entities: T[]): Promise<T[]> {
    if (entities.length === 0) {
      return []
    }
    const result = await this.collection.insertMany(entities as any)
    return entities.map((entity, index) => ({
      ...entity,
      _id: result.insertedIds[index],
    }))
  }

  @EnsureInitialized
  public async updateById(id: ObjectId, entity: Partial<T>): Promise<T | null> {
    entity.updated_at = new Date()

    const result = await this.collection.findOneAndUpdate(
      { _id: id } as any,
      { $set: entity },
      { returnDocument: 'after' },
    )

    return result as T | null
  }
}
