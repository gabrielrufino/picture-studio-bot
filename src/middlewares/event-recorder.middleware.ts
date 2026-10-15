import type { NextFunction } from 'grammy'
import type { CustomContext } from '@/types/custom-context.type'
import { logger } from '@/config/logger'
import { EventEntity } from '@/entities/event.entity'
import { CommandEnum } from '@/enums/command.enum'
import { EventEnum } from '@/enums/event.enum'
import { eventRepository } from '@/repositories'

function buildEventMaps() {
  const command = new Map<string, EventEnum>()
  const button = new Map<string, EventEnum>()

  for (const [key, value] of Object.entries(CommandEnum)) {
    const cmd = EventEnum[`Command${key}` as keyof typeof EventEnum]
    if (cmd) {
      command.set(value, cmd)
    }

    const btn = EventEnum[`Button${key}` as keyof typeof EventEnum]
    if (btn) {
      button.set(value, btn)
    }
  }

  return { command, button } as const
}

const { command: commandToEventMap, button: buttonToEventMap } = buildEventMaps()

export async function eventRecorderMiddleware(ctx: CustomContext, next: NextFunction) {
  if (!ctx.from) {
    return next()
  }

  const events: EventEntity[] = []

  // Check for command
  if (ctx.message?.text?.startsWith('/')) {
    const rawCommand = ctx.message.text.split(' ')[0].substring(1)
    const eventValue = commandToEventMap.get(rawCommand)

    if (eventValue) {
      events.push(new EventEntity({
        event: eventValue,
        telegram_user: ctx.from,
      }))
    }
  }

  // Check for callback query (button click)
  if (ctx.callbackQuery?.data) {
    const rawData = ctx.callbackQuery.data
    const eventValue = buttonToEventMap.get(rawData)

    if (eventValue) {
      events.push(new EventEntity({
        event: eventValue,
        telegram_user: ctx.from,
      }))
    }
  }

  // Check for file document received
  if (ctx.message?.document) {
    events.push(new EventEntity({
      event: EventEnum.FileReceived,
      telegram_user: ctx.from,
      metadata: { mime_type: ctx.message.document.mime_type },
    }))
  }

  // Check for photo received
  if (ctx.message?.photo) {
    events.push(new EventEntity({
      event: EventEnum.FileReceived,
      telegram_user: ctx.from,
      metadata: { mime_type: 'image/jpeg' },
    }))
  }

  if (events.length > 0) {
    // Fire and forget to not block the request
    eventRepository.insertMany(events).catch((error) => {
      logger.error({ error }, 'Failed to record events')
    })
  }

  return next()
}
