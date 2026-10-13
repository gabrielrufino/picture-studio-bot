import type { BaseHandler } from './base.handler'
import { configurationRepository, feedbackRepository, paymentRepository, userRepository } from '../repositories'
import { CompressHandler } from './compress.handler'
import { ConvertHandler } from './convert.handler'
import { CropHandler } from './crop.handler'
import { FeedbackHandler } from './feedback.handler'
import { HelpHandler } from './help.handler'
import { LanguageHandler } from './language.handler'
import { ProHandler } from './pro.handler'
import { ResizeHandler } from './resize.handler'
import { RotateHandler } from './rotate.handler'
import { StartHandler } from './start.handler'
import { VersionHandler } from './version.handler'

const coreHandlers: Array<BaseHandler> = [
  new CompressHandler(userRepository),
  new ConvertHandler(userRepository),
  new CropHandler(userRepository),
  new FeedbackHandler(feedbackRepository),
  new LanguageHandler(userRepository),
  new ProHandler(userRepository, paymentRepository, configurationRepository),
  new ResizeHandler(userRepository),
  new RotateHandler(userRepository),
  new StartHandler(userRepository),
  new VersionHandler(),
]

const helpHandler = new HelpHandler(coreHandlers)

export const handlers: Array<BaseHandler> = [
  helpHandler,
  ...coreHandlers,
]
