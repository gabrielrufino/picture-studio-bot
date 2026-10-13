import type { CustomContext } from '../types/custom-context.type'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandEnum } from '../enums/command.enum'
import { VersionHandler } from './version.handler'

describe(VersionHandler.name, () => {
  let handler: VersionHandler
  let ctx: CustomContext

  beforeEach(() => {
    handler = new VersionHandler()
    ctx = { t: (key: string) => key, reply: vi.fn() } as unknown as CustomContext
  })

  it('should have correct command', () => {
    expect(handler.command).toBe(CommandEnum.Version)
  })

  describe(VersionHandler.prototype.onCommand.name, () => {
    it('should reply with package version', async () => {
      await handler.onCommand(ctx)

      expect(ctx.reply).toHaveBeenCalledWith('version_info', { parse_mode: 'HTML' })
    })
  })
})
