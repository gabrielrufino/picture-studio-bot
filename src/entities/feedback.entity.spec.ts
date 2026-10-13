import { describe, expect, it } from 'vitest'
import { FeedbackEntity } from './feedback.entity'

describe(FeedbackEntity.name, () => {
  it('should create a feedback entity', () => {
    const feedback = new FeedbackEntity({
      chat: { id: 1 },
      from: { id: 2, first_name: 'John', is_bot: false },
      date: 123456,
      message_id: 3,
      text: 'Great bot!',
    } as any)
    expect(feedback).toBeInstanceOf(FeedbackEntity)
    expect(feedback.text).toBe('Great bot!')
  })
})
