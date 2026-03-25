import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
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

const conversationSchema = new mongoose.Schema({
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
  status: {
    type: String,
    enum: ['active', 'waiting_rating', 'closed'],
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

export default mongoose.model('Conversation', conversationSchema);
