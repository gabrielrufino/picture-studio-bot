export const PLAN_EXPIRATION_DAYS = 30

export function isPlanExpired(planStartedAt?: Date | null): boolean {
  if (!planStartedAt) {
    return false
  }

  const expirationDate = new Date()
  expirationDate.setDate(expirationDate.getDate() - PLAN_EXPIRATION_DAYS)

  return planStartedAt < expirationDate
}
