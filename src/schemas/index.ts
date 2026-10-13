import { z } from 'zod'

export const CompressParamsSchema = z.object({
  file_id: z.string(),
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
