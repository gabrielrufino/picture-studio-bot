import type { Db } from 'mongodb'
import type { ConfigurationEntity } from '../entities/configuration.entity'
import { EnsureInitialized } from '../decorators/ensure-initialized.decorator'
import { BaseRepository } from './base.repository'

const GLOBAL_CONFIG_ID = 'global_config' as const

export class ConfigurationRepository extends BaseRepository<ConfigurationEntity> {
  private static readonly CACHE_TTL_MS = 30_000

  private cachedConfig: { value: ConfigurationEntity, expiresAt: number } | null = null
  private pendingFetch: Promise<ConfigurationEntity> | null = null

  constructor(database: Db) {
    super({
      collectionName: 'configurations',
      database,
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['_id', 'pro_price', 'maintenance_mode', 'created_at', 'updated_at'],
          properties: {
            _id: {
              bsonType: 'string',
            },
            pro_price: {
              bsonType: 'number',
              minimum: 1,
            },
            maintenance_mode: {
              bsonType: 'bool',
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
    })
  }

  public async init(): Promise<void> {
    await super.init()
    await this.seed()
    this.clearCache()
  }

  @EnsureInitialized
  public async findGlobalConfig(): Promise<ConfigurationEntity> {
    if (this.cachedConfig && Date.now() <= this.cachedConfig.expiresAt) {
      return this.cachedConfig.value
    }

    if (!this.pendingFetch) {
      this.pendingFetch = this.fetchAndCache()
    }

    return this.pendingFetch
  }

  public clearCache(): void {
    this.cachedConfig = null
    this.pendingFetch = null
  }

  private async fetchAndCache(): Promise<ConfigurationEntity> {
    try {
      const config = await this.collection.findOne({ _id: GLOBAL_CONFIG_ID }) as ConfigurationEntity | null
      if (!config) {
        throw new Error('Global configuration not found')
      }
      this.cachedConfig = {
        value: config,
        expiresAt: Date.now() + ConfigurationRepository.CACHE_TTL_MS,
      }
      return config
    }
    finally {
      this.pendingFetch = null
    }
  }

  private async seed(): Promise<void> {
    const exists = await this.collection.findOne({ _id: GLOBAL_CONFIG_ID } as any)
    if (!exists) {
      const now = new Date()
      await this.collection.insertOne({
        _id: GLOBAL_CONFIG_ID,
        pro_price: 350,
        maintenance_mode: false,
        created_at: now,
        updated_at: now,
      } as any)
    }
    else if (exists.maintenance_mode === undefined) {
      await this.collection.updateOne(
        { _id: GLOBAL_CONFIG_ID } as any,
        {
          $set: {
            maintenance_mode: false,
            updated_at: new Date(),
          },
        },
      )
    }
  }
}
