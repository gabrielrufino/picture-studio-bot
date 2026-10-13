import { z } from 'zod'

export const RotateParamsSchema = z.object({
  file_id: z.string(),
})

export type RotateParams = z.infer<typeof RotateParamsSchema>
