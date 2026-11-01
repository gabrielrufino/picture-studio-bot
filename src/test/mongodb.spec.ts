import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
    expect(clientA.database.databaseName).toBe('pdf_studio_test_isolation_a')
    expect(clientB.database.databaseName).toBe('pdf_studio_test_isolation_b')
    expect(clientA.database.databaseName).not.toBe(clientB.database.databaseName)
  })
})
