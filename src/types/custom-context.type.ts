import type { FileFlavor } from '@grammyjs/files'
import type { Context, SessionFlavor } from 'grammy'
import type { UserEntity } from '../entities/user.entity'
import type { SessionData } from '../interfaces/session-data.interface'

export type CustomContext = FileFlavor<Context> & SessionFlavor<SessionData> & {
  t: (key: string) => string
  user?: UserEntity | null
}
