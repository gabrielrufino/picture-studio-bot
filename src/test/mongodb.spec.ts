import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { connectToTestDatabase } from '@/test/mongodb'

describe(connectToTestDatabase.name, () => {
  let clientA: Awaited<ReturnType<typeof connectToTestDatabase>>
  let clientB: Awaited<ReturnType<typeof connectToTestDatabase>>

  beforeAll(async () => {
    ;[clientA, clientB] = await Promise.all([
      connectToTestDatabase('isolation_a'),
      connectToTestDatabase('isolation_b'),
    ])
  })

  afterAll(async () => {
    await clientA.client.close()
    await clientB.client.close()
  })

  it('should return different databases for different names', () => {
    expect(clientA.database.databaseName.startsWith('pdf_studio_test_isolation_a_')).toBe(true)
    expect(clientB.database.databaseName.startsWith('pdf_studio_test_isolation_b_')).toBe(true)
    expect(clientA.database.databaseName).not.toBe(clientB.database.databaseName)
  })

  it('should use a new run identifier in a fresh module instance', async () => {
    vi.resetModules()
    const { connectToTestDatabase: connectFresh } = await import('@/test/mongodb')
    const fresh = await connectFresh('isolation_a')
    try {
      expect(fresh.database.databaseName).not.toBe(clientA.database.databaseName)
    }
    finally {
      await fresh.client.close()
    }
  })
})
