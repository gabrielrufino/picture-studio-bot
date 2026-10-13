import { describe, expect, it } from 'vitest'
import { formatString } from './format.util'

describe(formatString.name, () => {
  it('should replace a single placeholder', () => {
    const result = formatString('Hello {name}!', { name: 'World' })

    expect(result).toBe('Hello World!')
  })

  it('should replace multiple placeholders', () => {
    const result = formatString('Progress: {current}/{max}', { current: '1', max: '10' })

    expect(result).toBe('Progress: 1/10')
  })

  it('should leave unmatched placeholders untouched', () => {
    const result = formatString('Hello {name}, your code is {code}', { name: 'Alice' })

    expect(result).toBe('Hello Alice, your code is {code}')
  })

  it('should not perform secondary replacement on replaced values', () => {
    const result = formatString('File {name} uploaded. Count: {current}/{max}', {
      name: 'malicious_{current}_{max}.pdf',
      current: '1',
      max: '10',
    })

    expect(result).toBe('File malicious_{current}_{max}.pdf uploaded. Count: 1/10')
  })

  it('should handle empty string replacements correctly', () => {
    const result = formatString('prefix_{empty}_suffix', { empty: '' })

    expect(result).toBe('prefix__suffix')
  })
})
