import { IConversation } from '../../models/Conversation.js';

export type ConversationStatus =
  | 'active'
  | 'waiting_rating'
  | 'waiting_escalation_issue'
  | 'closed';

export type ParsedResponseType = 'IT_PROBLEM' | 'IT_INFO' | 'OUT_OF_SCOPE';

export interface RegistrationState {
  step: 1 | 2;
  otp?: string;
  otpExpiresAt?: number;
  tempPayload?: {
    name: string;
    employeeId: string;
    department: string;
    email?: string;
    phone?: string;
  };
  updatedAt: number;
}

export interface QuickReplyItem {
  label: string;
  text: string;
}

export interface GeminiImageAnalysis {
  description?: string;
  response: string;
}

export interface GeminiPdfAnalysis {
  response: string;
}

export interface ParsedGeminiResponse {
  content: string;
  type: ParsedResponseType;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export type ConversationDoc = IConversation & {
  createdAt: Date;
  closedAt?: Date;
  resolved?: boolean;
  escalated?: boolean;
  rating?: number;
  issue?: string;
  nonItCount?: number;
  status: ConversationStatus;
  sessionId: string;
  messages: ConversationMessage[];
  save: () => Promise<ConversationDoc>;
};
