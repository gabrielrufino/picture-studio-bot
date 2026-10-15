import type { Nullable } from '@gabrielrufino/types'
import type { CommandEnum } from '@/enums/command.enum'
import type { LanguageEnum } from '@/enums/language.enum'
import type { CompressParams, ConvertParams, CropParams, ResizeParams, RotateParams } from '@/schemas'

export interface SessionData {
  command: Nullable<CommandEnum>
  params: Nullable<CompressParams | ConvertParams | CropParams | ResizeParams | RotateParams>
  language?: Nullable<LanguageEnum>
}
