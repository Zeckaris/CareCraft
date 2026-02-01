import { Schema, model, Types } from 'mongoose';
import { IBadgeCriteria } from '../types/badgeCriteria.type.js';

const badgeCriteriaSchema = new Schema<IBadgeCriteria>(
  {
    badgeDefinitionId: { type: Schema.Types.ObjectId, ref: 'BadgeDefinition', required: true },
    type: { type: String, enum: ['scoreThreshold', 'actionPlanProgress', 'observationCount', 'custom', 'attributeEvaluationAverage'], required: true },
    attributeCategoryId: { type: Schema.Types.ObjectId, ref: 'AttributeCategory', default: null },
    minScore: { type: Number, default: null },
    actionPlanId: { type: Schema.Types.ObjectId, ref: 'ActionPlan', default: null },
    minProgress: { type: Number, default: null },
    minObservations: { type: Number, default: null },
    scope: { type: String, enum: ['yearly', 'allTime'], default: null },
    description: { type: String, default: '' }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false }
  }
);

export const BadgeCriteria = model<IBadgeCriteria>('BadgeCriteria', badgeCriteriaSchema);