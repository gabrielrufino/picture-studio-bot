import { z } from 'zod'
import { WATERMARK_MAX_PHOTOS } from '@/config/constants'

export const CompressParamsSchema = z.object({
  file_id: z.string(),
  paths: z.array(z.string()).optional(),
  quality: z.number().min(1).max(100).optional(),
})

export type CompressParams = z.infer<typeof CompressParamsSchema>

export const ConvertParamsSchema = z.object({
  file_id: z.string(),
})

export type ConvertParams = z.infer<typeof ConvertParamsSchema>

export const CropParamsSchema = z.object({
  file_id: z.string(),
})

export type CropParams = z.infer<typeof CropParamsSchema>

export const ResizeParamsSchema = z.object({
  file_id: z.string(),
})

export type ResizeParams = z.infer<typeof ResizeParamsSchema>

export const RotateParamsSchema = z.object({
  file_id: z.string(),
})

export type RotateParams = z.infer<typeof RotateParamsSchema>

export const WatermarkCornerSchema = z.enum([
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
])

export const WatermarkScaleSchema = z.enum([
  'auto',
  'small',
  'medium',
  'large',
])

export const WatermarkStepSchema = z.enum([
  'collecting_bases',
  'awaiting_watermark',
  'positions',
  'scale',
])

export const WatermarkParamsSchema = z.object({
  step: WatermarkStepSchema.optional(),
  base_file_ids: z.array(z.string()).default([]),
  watermark_file_id: z.string().optional(),
  positions: z.array(WatermarkCornerSchema).default([]),
  scale: WatermarkScaleSchema.default('auto'),
  limit_warned: z.boolean().optional(),
  paths: z.array(z.string()).optional(),
  callback_message_id: z.number().optional(),
})

export const WatermarkConfiguredParamsSchema = WatermarkParamsSchema.extend({
  base_file_ids: z.array(z.string()).min(1).max(WATERMARK_MAX_PHOTOS),
  watermark_file_id: z.string(),
})

export const WatermarkProcessParamsSchema = WatermarkConfiguredParamsSchema.extend({
  positions: z.array(WatermarkCornerSchema).min(1),
})

export type WatermarkCorner = z.infer<typeof WatermarkCornerSchema>
export type WatermarkScale = z.infer<typeof WatermarkScaleSchema>
export type WatermarkStep = z.infer<typeof WatermarkStepSchema>
export type WatermarkParams = z.infer<typeof WatermarkParamsSchema>
export type WatermarkConfiguredParams = z.infer<typeof WatermarkConfiguredParamsSchema>
export type WatermarkProcessParams = z.infer<typeof WatermarkProcessParamsSchema>
