import { faker } from '@faker-js/faker'
import { describe, expect, it } from 'vitest'

import { add } from '.'

describe('add', () => {
  it('should add two numbers', () => {
    const a = faker.number.int()
    const b = faker.number.int()

    expect(add(a, b)).toBe(a + b)
  })
})
