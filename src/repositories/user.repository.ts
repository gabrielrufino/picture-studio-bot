import type { Db, Filter } from 'mongodb'
import { EnsureInitialized } from '../decorators/ensure-initialized.decorator'
import { UserEntity } from '../entities/user.entity'
import { LanguageEnum } from '../enums/language.enum'
import { PlanTypeEnum } from '../enums/plan-type.enum'
import { BaseRepository } from './base.repository'

export class UserRepository extends BaseRepository<UserEntity> {
  constructor(database: Db) {
    super({
      collectionName: 'users',
      database,
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['telegram_user', 'is_blocked', 'created_at', 'updated_at'],
          properties: {
            telegram_user: {
              bsonType: 'object',
            },
            is_blocked: {
              bsonType: 'bool',
            },
            is_bot_blocked: {
              bsonType: 'bool',
            },
            plan_type: {
              bsonType: 'string',
              enum: Object.values(PlanTypeEnum),
            },
            plan_started_at: {
              bsonType: ['date', 'null'],
            },
            daily_usage_count: {
              bsonType: 'int',
            },
            last_usage_date: {
              bsonType: ['string', 'null'],
            },
            language: {
              bsonType: 'string',
              enum: Object.values(LanguageEnum),
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
      indexes: ['telegram_user.id', 'last_usage_date', 'created_at'],
    })
  }

  @EnsureInitialized
  public async findByTelegramId(telegramId: number): Promise<UserEntity | null> {
    const result = await this.collection.findOne({ 'telegram_user.id': telegramId })
    return result ? new UserEntity(result as any) : null
  }

  @EnsureInitialized
  public async findInactiveUsers(days: number): Promise<AsyncIterableIterator<UserEntity>> {
    const endWindow = new Date()
    endWindow.setDate(endWindow.getDate() - days) // 30 days ago
    const endWindowStr = endWindow.toISOString().split('T')[0]

    const filter: Record<string, unknown> = {
      is_blocked: { $ne: true },
      is_bot_blocked: { $ne: true },
      $or: [
        { last_usage_date: { $lt: endWindowStr, $ne: null } },
        {
          last_usage_date: null,
          created_at: { $lt: endWindow },
        },
      ],
    }

    const cursor = this.collection.find(filter as unknown as Filter<UserEntity>)

    return (async function* () {
      for await (const user of cursor) {
        yield new UserEntity(user as any)
      }
    })()
  }

  @EnsureInitialized
  public async incrementUsage(telegramId: number, limit?: number): Promise<UserEntity | null> {
    const today = new Date().toISOString().split('T')[0]

    const filter: any = { 'telegram_user.id': telegramId, 'is_blocked': { $ne: true } }

    if (limit !== undefined) {
      filter.$or = [
        { last_usage_date: { $ne: today } },
        {
          $and: [
            { last_usage_date: today },
            { daily_usage_count: { $lt: limit } },
          ],
        },
      ]
    }

    const result = await this.collection.findOneAndUpdate(
      filter,
      [
        {
          $set: {
            daily_usage_count: {
              $cond: {
                if: { $ne: ['$last_usage_date', today] },
                then: 1,
                else: { $add: ['$daily_usage_count', 1] },
              },
            },
            last_usage_date: today,
            updated_at: new Date(),
          },
        },
      ],
      { returnDocument: 'after' },
    )

    return result ? new UserEntity(result as any) : null
  }

  @EnsureInitialized
  public async decrementUsage(telegramId: number): Promise<UserEntity | null> {
    const today = new Date().toISOString().split('T')[0]

    const filter: any = {
      'telegram_user.id': telegramId,
      'is_blocked': { $ne: true },
      'last_usage_date': today,
      'daily_usage_count': { $gt: 0 },
    }

    const result = await this.collection.findOneAndUpdate(
      filter,
      {
        $inc: { daily_usage_count: -1 },
        $set: { updated_at: new Date() },
      },
      { returnDocument: 'after' },
    )

    return result ? new UserEntity(result as any) : null
  }
}
