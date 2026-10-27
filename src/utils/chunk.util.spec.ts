import { describe, expect, it } from 'vitest'
import { chunk } from './chunk.util'

describe(chunk.name, () => {
  it('should return an empty array for an empty input', () => {
    expect(chunk([], 10)).toEqual([])
  })

  it('should return a single chunk for one item', () => {
    expect(chunk(['a'], 10)).toEqual([['a']])
  })

  it('should return a single chunk when the size matches the input length', () => {
    expect(chunk(Array.from({ length: 10 }, (_, i) => i), 10)).toEqual([
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    ])
  })

  it('should split into two chunks when the input exceeds the size by one', () => {
    expect(chunk(Array.from({ length: 11 }, (_, i) => i), 10)).toEqual([
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      [10],
    ])
  })

  it('should split one hundred items into ten chunks', () => {
    const result = chunk(Array.from({ length: 100 }, (_, i) => i), 10)

    expect(result).toHaveLength(10)
    for (let index = 0; index < 10; index++) {
      expect(result[index]).toEqual(
        Array.from({ length: 10 }, (_, i) => index * 10 + i),
      )
    }
  })

  it('should not mutate the input array', () => {
    const items = [1, 2, 3]

    chunk(items, 2)

    expect(items).toEqual([1, 2, 3])
  })

  it('should throw for a zero size', () => {
    expect(() => chunk([1], 0)).toThrow(RangeError)
  })

  it('should throw for a negative size', () => {
    expect(() => chunk([1], -1)).toThrow(RangeError)
  })
})
