import { Document, Types } from "mongoose";

export interface IBadgeCriteria extends Document {
  badgeDefinitionId: Types.ObjectId;
  type: "scoreThreshold" | "actionPlanProgress" | "observationCount" | "custom";
  attributeCategoryId?: Types.ObjectId | null;
  minScore?: number | null;
  actionPlanId?: Types.ObjectId | null;
  minProgress?: number | null;
  minObservations?: number | null;
  description?: string;
  createdAt?: Date;
}
