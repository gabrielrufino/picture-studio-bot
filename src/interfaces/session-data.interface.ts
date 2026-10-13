import type { Nullable } from '@gabrielrufino/types'
import type { CommandEnum } from '../enums/command.enum'
import type { LanguageEnum } from '../enums/language.enum'
import type { CompressParams } from '../schemas/compress-params.schema'
import type { ConvertParams } from '../schemas/convert-params.schema'
import type { CropParams } from '../schemas/crop-params.schema'
import type { ResizeParams } from '../schemas/resize-params.schema'
import type { RotateParams } from '../schemas/rotate-params.schema'

export interface SessionData {
  command: Nullable<CommandEnum>
  params: Nullable<CompressParams | ConvertParams | CropParams | ResizeParams | RotateParams>
  language?: Nullable<LanguageEnum>
}
