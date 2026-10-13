import type { Message } from '../interfaces/message.interface'
import type { CustomContext } from '../types/custom-context.type'

export class WelcomeMessage implements Message {
  constructor(private readonly ctx: CustomContext) {}

  public build() {
    return this.ctx.t('welcome')
  }
}
