import type { CustomContext } from '../types/custom-context.type'
import { version } from '../../package.json'
import { CommandEnum } from '../enums/command.enum'
import { formatString } from '../utils/format.util'
import { BaseHandler } from './base.handler'

export class VersionHandler extends BaseHandler {
  public readonly command = CommandEnum.Version
  public readonly description = 'ℹ️ Show the bot version'
  public readonly hasUsageLimits = false
  public readonly events = {}

  async onCommand(ctx: CustomContext) {
    await ctx.reply(formatString(ctx.t('version_info'), { version }), { parse_mode: 'HTML' })
  }
}
