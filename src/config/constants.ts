import { PlanTypeEnum } from '@/enums/plan-type.enum'

export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
export const MAX_PRO_FILE_SIZE = 50 * 1024 * 1024 // 50MB

export const DAILY_LIMITS = {
  [PlanTypeEnum.Free]: 3,
  [PlanTypeEnum.Pro]: 50,
}

export const PHOTOS_PER_OPERATION_LIMITS = {
  [PlanTypeEnum.Free]: 3,
  [PlanTypeEnum.Pro]: 100,
}

export const WATERMARK_MEDIA_GROUP_SIZE = 10 // Telegram's maximum items per media group
export const WATERMARK_MAX_PHOTOS = PHOTOS_PER_OPERATION_LIMITS[PlanTypeEnum.Pro]
