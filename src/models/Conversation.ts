// Conversation.ts
import mongoose, { Document, Schema } from 'mongoose';

export interface IMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface IConversation extends Document {
  lineUserId: string;
  sessionId: string;
  messages: IMessage[];
  issue: string;
  resolved: boolean;
  rating: number | null;
  feedback: string;
  escalated: boolean;
  nonItCount: number;
  assetInfo?: string;
  status: 'active' | 'waiting_rating' | 'waiting_escalation_issue' | 'waiting_hardware_confirm' | 'closed';
  createdAt: Date;
  closedAt: Date | null;
}

const messageSchema = new Schema<IMessage>({
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const conversationSchema = new Schema<IConversation>({
  lineUserId: {
    type: String,
    required: true,
    index: true
  },
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  messages: [messageSchema],
  issue: {
    type: String,
    default: ''
  },
  resolved: {
    type: Boolean,
    default: false
  },
  rating: {
    type: Number,
    min: 1,
    max: 5,
    default: null
  },
  feedback: {
    type: String,
    default: ''
  },
  escalated: {
    type: Boolean,
    default: false
  },
  nonItCount: {
    type: Number,
    default: 0
  },
  assetInfo: {
    type: String,
    required: false
  },
  status: {
    type: String,
    enum: ['active', 'waiting_rating', 'waiting_escalation_issue', 'waiting_hardware_confirm', 'closed'],
    default: 'active'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  closedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Index for queries
conversationSchema.index({ lineUserId: 1, createdAt: -1 });
conversationSchema.index({ status: 1 });

export default mongoose.model<IConversation>('Conversation', conversationSchema);
