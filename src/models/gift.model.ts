import { Schema, model } from 'mongoose'
import { IGift } from '../types/gift.type.js'

const giftSchema = new Schema<IGift>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, default: '', maxlength: 500 },
    image: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'UserAccount',
      required: true,
    },
  },
  {
    timestamps: true,
  }
)

// Gift names are unique case-insensitively. The controller returns a friendly
// error; this index is the final guard against concurrent creates.
giftSchema.index(
  { name: 1 },
  {
    unique: true,
    name: 'gift_name_unique',
    collation: { locale: 'en', strength: 2 },
  }
)

export const Gift = model<IGift>('Gift', giftSchema)
