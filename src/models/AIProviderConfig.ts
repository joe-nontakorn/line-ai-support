import mongoose, { Schema } from 'mongoose';

export interface IAIProviderConfigDocument {
  _id: mongoose.Types.ObjectId;
  provider: 'gemini' | 'openrouter';
  model: string;
  apiKeyEncrypted: string;
  status: 'active' | 'inactive';
  lastValidated: Date;
  validationStatus: 'valid' | 'invalid' | 'unknown';
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AIProviderConfigSchema = new Schema(
  {
    provider: {
      type: String,
      enum: ['gemini', 'openrouter'],
      required: true,
      unique: true,
    },
    model: {
      type: String,
      required: true,
    },
    apiKeyEncrypted: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'inactive',
    },
    lastValidated: {
      type: Date,
      default: null,
    },
    validationStatus: {
      type: String,
      enum: ['valid', 'invalid', 'unknown'],
      default: 'unknown',
    },
    errorMessage: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

export default mongoose.model<IAIProviderConfigDocument>(
  'AIProviderConfig',
  AIProviderConfigSchema,
);
