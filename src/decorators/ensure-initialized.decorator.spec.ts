import type { Db, Document } from 'mongodb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseRepository } from '../repositories/base.repository'
import { EnsureInitialized } from './ensure-initialized.decorator'

interface MockEntity extends Document {
  updated_at: Date
}

class MockRepository extends BaseRepository<MockEntity> {
  constructor() {
    const mockDb = {
      collection: vi.fn().mockReturnValue({}),
    } as unknown as Db

    super({
      collectionName: 'mock',
      database: mockDb,
      validator: {},
    })

    this.init = vi.fn().mockResolvedValue(undefined)
  }

  public setInitialized(value: boolean) {
    this.initialized = value
  }

  @EnsureInitialized
  async doSomething(arg: string) {
    return `done ${arg}`
  }
}

describe(EnsureInitialized.name, () => {
  let repo: MockRepository

  beforeEach(() => {
    repo = new MockRepository()
  })

  it('should call init if initialized is false', async () => {
    repo.setInitialized(false)
    const result = await repo.doSomething('test')
    expect(repo.init).toHaveBeenCalled()
    expect(result).toBe('done test')
  })

  it('should not call init if initialized is true', async () => {
    repo.setInitialized(true)
    const result = await repo.doSomething('test')
    expect(repo.init).not.toHaveBeenCalled()
    expect(result).toBe('done test')
  })
})
