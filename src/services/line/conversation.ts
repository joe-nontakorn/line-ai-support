import { v4 as uuidv4 } from 'uuid';
import Conversation from '../../models/Conversation.js';
import User from '../../models/User.js';
import geminiService from '../gemini.js';
import { ConversationDoc, ConversationStatus, ConversationMessage } from './types.js';
import { getBangkokDateKey, now, sanitizeFreeText } from './utils.js';

export class ConversationService {
  async getActiveConversation(userId: string): Promise<ConversationDoc | null> {
    const conversation = (await Conversation.findOne({
      lineUserId: userId,
      status: 'active',
    }).sort({ createdAt: -1 })) as ConversationDoc | null;

    if (!conversation) return null;

    const todayDate = now();
    const todayKey = getBangkokDateKey(todayDate);
    const createdKey = getBangkokDateKey(new Date(conversation.createdAt));

    if (todayKey !== createdKey) {
      conversation.status = 'closed';
      conversation.closedAt = todayDate;
      await conversation.save();
      return null;
    }

    return conversation;
  }

  async getLatestConversationByStatuses(
    userId: string,
    statuses: ConversationStatus[],
  ): Promise<ConversationDoc | null> {
    return (await Conversation.findOne({
      lineUserId: userId,
      status: { $in: statuses },
    }).sort({ createdAt: -1 })) as ConversationDoc | null;
  }

  async closeAllActiveConversations(userId: string): Promise<void> {
    await Conversation.updateMany(
      {
        lineUserId: userId,
        status: { $in: ['active', 'waiting_escalation_issue', 'waiting_rating'] },
      },
      {
        $set: {
          status: 'closed',
          closedAt: now(),
        },
      },
    );
  }

  async createNewConversation(
    userId: string,
    status: ConversationStatus = 'active',
  ): Promise<ConversationDoc> {
    return (await Conversation.create({
      lineUserId: userId,
      sessionId: uuidv4(),
      messages: [],
      status,
      nonItCount: 0,
    })) as ConversationDoc;
  }

  async closeConversation(conversation: ConversationDoc): Promise<void> {
    conversation.status = 'closed';
    conversation.closedAt = now();
    await conversation.save();
  }

  async appendUserMessage(conversation: ConversationDoc, text: string): Promise<void> {
    conversation.messages.push({
      role: 'user',
      content: sanitizeFreeText(text),
      timestamp: now(),
    });
    await conversation.save();
  }

  async appendAssistantMessage(conversation: ConversationDoc, text: string): Promise<void> {
    conversation.messages.push({
      role: 'assistant',
      content: sanitizeFreeText(text),
      timestamp: now(),
    });
    await conversation.save();
  }

  async analyzeIssueSafe(messages: ConversationMessage[]): Promise<string> {
    try {
      const result = await geminiService.analyzeIssue(messages);
      return typeof result === 'string' && result.trim() ? result.trim() : 'ไม่สามารถสรุปปัญหาได้';
    } catch (error) {
      console.error('Error analyzing issue:', error);
      return 'ไม่สามารถสรุปปัญหาได้';
    }
  }

  async getUser(userId: string) {
    return await User.findOne({ lineUserId: userId });
  }

  async saveOrUpdateUser(userId: string, payload: {
    name: string;
    employeeId: string;
    department: string;
    email?: string;
    phone?: string;
  }): Promise<void> {
    await User.findOneAndUpdate(
      { lineUserId: userId },
      {
        $set: {
          lineUserId: userId,
          name: payload.name,
          employeeId: payload.employeeId,
          department: payload.department,
          email: payload.email,
          phone: payload.phone,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );
  }
}
