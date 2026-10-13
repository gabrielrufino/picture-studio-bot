import type { NextFunction } from 'grammy'
import type { CustomContext } from '../types/custom-context.type'
import { configurationRepository } from '../repositories'

export function clearMaintenanceCache() {
  configurationRepository.clearCache()
}

export async function maintenanceMiddleware(ctx: CustomContext, next: NextFunction) {
  const config = await configurationRepository.findGlobalConfig()

  if (!config?.maintenance_mode) {
    return next()
  }

  await ctx.reply(ctx.t('maintenance_mode_active'))
}
