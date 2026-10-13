import { database } from '../config/database'
import { ConfigurationRepository } from './configuration.repository'
import { EventRepository } from './event.repository'
import { FeedbackRepository } from './feedback.repository'
import { MessageRepository } from './message.repository'
import { PaymentRepository } from './payment.repository'
import { UserRepository } from './user.repository'

export const configurationRepository = new ConfigurationRepository(database)
export const eventRepository = new EventRepository(database)
export const feedbackRepository = new FeedbackRepository(database)
export const messageRepository = new MessageRepository(database)
export const paymentRepository = new PaymentRepository(database)
export const userRepository = new UserRepository(database)

export const repositories = [
  configurationRepository,
  eventRepository,
  feedbackRepository,
  messageRepository,
  paymentRepository,
  userRepository,
]
