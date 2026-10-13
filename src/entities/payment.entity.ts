import type { ObjectId } from 'mongodb'
import type { CurrencyEnum } from '../enums/currency.enum'
import { BaseEntity } from './base.entity'

export class PaymentEntity extends BaseEntity {
  constructor(input?: Partial<PaymentEntity>) {
    super()
    this.assign(input)
  }

  declare user_id: ObjectId

  declare amount: number

  declare currency: CurrencyEnum
}
