// service/line.ts
import User from '../models/User.js';
import Conversation, { IConversation } from '../models/Conversation.js';
import geminiService from './gemini.js';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import {
  Client,
  MessageEvent,
  FollowEvent,
  TextEventMessage,
  ImageEventMessage,
  FileEventMessage,
  MessageAPIResponseBase,
  TextMessage,
} from '@line/bot-sdk';

type ConversationStatus =
  | 'active'
  | 'waiting_rating'
  | 'waiting_escalation_issue'
  | 'closed';

type ParsedResponseType = 'IT_PROBLEM' | 'IT_INFO' | 'OUT_OF_SCOPE';

interface RegistrationState {
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

interface QuickReplyItem {
  label: string;
  text: string;
}

interface GeminiImageAnalysis {
  description?: string;
  response: string;
}

interface GeminiPdfAnalysis {
  response: string;
}

interface ParsedGeminiResponse {
  content: string;
  type: ParsedResponseType;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

type ConversationDoc = IConversation & {
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

const REGISTRATION_TTL_MS = 30 * 60 * 1000;
const MAX_LINE_TEXT_LENGTH = 4500; // กันไว้ต่ำกว่า limit จริง
const LOADING_SECONDS = 20;
const SUPPORT_COMMANDS = new Set([
  'ยังแก้ไม่ได้',
  'ติดต่อเจ้าหน้าที่',
  'เริ่มสนทนาใหม่',
  '/start',
  '/help',
  'ช่วยเหลือ',
  'แก้ได้แล้ว',
]);

const registrationStates = new Map<string, RegistrationState>();

export class LineService {
  private client: Client;

  constructor(lineClient: Client) {
    this.client = lineClient;
  }

  private now(): Date {
    return new Date();
  }

  private getBangkokDateKey(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  private normalizeText(text: string): string {
    return text.trim().replace(/\s+/g, ' ');
  }

  private sanitizeFreeText(text: string): string {
    return text.replace(/\u0000/g, '').trim();
  }

  private isRegistrationStateExpired(state: RegistrationState): boolean {
    return Date.now() - state.updatedAt > REGISTRATION_TTL_MS;
  }

  private getRegistrationState(userId: string): RegistrationState | null {
    const state = registrationStates.get(userId);
    if (!state) return null;

    if (this.isRegistrationStateExpired(state)) {
      registrationStates.delete(userId);
      return null;
    }

    return state;
  }

  private setRegistrationState(userId: string, state: Omit<RegistrationState, 'updatedAt'>): void {
    registrationStates.set(userId, {
      ...state,
      updatedAt: Date.now(),
    });
  }

  private clearRegistrationState(userId: string): void {
    registrationStates.delete(userId);
  }

  private isValidEmployeeId(value: string): boolean {
    return /^[A-Za-z0-9_-]{3,30}$/.test(value.trim());
  }

  private normalizePhone(value: string): string {
    return value.replace(/[^\d+]/g, '');
  }

  private isValidPhone(value: string): boolean {
    const normalized = this.normalizePhone(value);
    return /^(\+?\d{8,15})$/.test(normalized);
  }

  private isValidName(value: string): boolean {
    const trimmed = value.trim();
    return trimmed.length >= 2 && trimmed.length <= 120;
  }

  private isValidDepartment(value: string): boolean {
    const trimmed = value.trim();
    return trimmed.length >= 2 && trimmed.length <= 120;
  }

  private isStrictRating(value: string): boolean {
    return /^[1-5]$/.test(value.trim());
  }

  private truncateText(text: string, maxLength: number = MAX_LINE_TEXT_LENGTH): string {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 20).trim()}\n\n[ข้อความถูกตัดเพื่อให้ส่งผ่าน LINE ได้]`;
  }

  private chunkText(text: string, maxLength: number = MAX_LINE_TEXT_LENGTH): string[] {
    const sanitized = text.trim();
    if (!sanitized) return [''];

    if (sanitized.length <= maxLength) {
      return [sanitized];
    }

    const chunks: string[] = [];
    let remaining = sanitized;

    while (remaining.length > maxLength) {
      let splitAt = remaining.lastIndexOf('\n', maxLength);
      if (splitAt < maxLength * 0.5) {
        splitAt = remaining.lastIndexOf(' ', maxLength);
      }
      if (splitAt < maxLength * 0.5) {
        splitAt = maxLength;
      }

      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }

    if (remaining.length > 0) {
      chunks.push(remaining);
    }

    return chunks;
  }

  private async replyText(
    replyToken: string,
    text: string,
  ): Promise<MessageAPIResponseBase | undefined> {
    const chunks = this.chunkText(text);
    const messages: TextMessage[] = chunks.map((chunk) => ({
      type: 'text',
      text: this.truncateText(chunk),
    }));

    return this.client.replyMessage(replyToken, messages);
  }

  private async replyTextWithQuickReply(
    replyToken: string,
    text: string,
    quickReplyItems: QuickReplyItem[],
  ): Promise<MessageAPIResponseBase | undefined> {
    const chunks = this.chunkText(text);
    const lastIndex = chunks.length - 1;

    const messages: TextMessage[] = chunks.map((chunk, index) => {
      if (index === lastIndex) {
        return {
          type: 'text',
          text: this.truncateText(chunk),
          quickReply: {
            items: quickReplyItems.map((item) => ({
              type: 'action',
              action: {
                type: 'message',
                label: item.label,
                text: item.text,
              },
            })),
          },
        };
      }

      return {
        type: 'text',
        text: this.truncateText(chunk),
      };
    });

    return this.client.replyMessage(replyToken, messages);
  }

  private async streamToBuffer(streamLike: AsyncIterable<Buffer>): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of streamLike) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private async fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 12000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  private async getActiveConversation(userId: string): Promise<ConversationDoc | null> {
    const conversation = (await Conversation.findOne({
      lineUserId: userId,
      status: 'active',
    }).sort({ createdAt: -1 })) as ConversationDoc | null;

    if (!conversation) {
      return null;
    }

    const todayKey = this.getBangkokDateKey(this.now());
    const createdKey = this.getBangkokDateKey(new Date(conversation.createdAt));

    if (todayKey !== createdKey) {
      conversation.status = 'closed';
      conversation.closedAt = this.now();
      await conversation.save();
      return null;
    }

    return conversation;
  }

  private async getLatestConversationByStatuses(
    userId: string,
    statuses: ConversationStatus[],
  ): Promise<ConversationDoc | null> {
    return (await Conversation.findOne({
      lineUserId: userId,
      status: { $in: statuses },
    }).sort({ createdAt: -1 })) as ConversationDoc | null;
  }

  private async createNewConversation(
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

  private async closeConversation(conversation: ConversationDoc): Promise<void> {
    conversation.status = 'closed';
    conversation.closedAt = this.now();
    await conversation.save();
  }

  private async appendUserMessage(conversation: ConversationDoc, text: string): Promise<void> {
    conversation.messages.push({
      role: 'user',
      content: this.sanitizeFreeText(text),
      timestamp: this.now(),
    });
    await conversation.save();
  }

  private async appendAssistantMessage(conversation: ConversationDoc, text: string): Promise<void> {
    conversation.messages.push({
      role: 'assistant',
      content: this.sanitizeFreeText(text),
      timestamp: this.now(),
    });
    await conversation.save();
  }

  private shouldSkipAddingAsIssueContext(text?: string): boolean {
    if (!text) return true;
    return SUPPORT_COMMANDS.has(text.trim());
  }

  private async analyzeIssueSafe(messages: ConversationMessage[]): Promise<string> {
    try {
      const result = await geminiService.analyzeIssue(messages);
      return typeof result === 'string' && result.trim() ? result.trim() : 'ไม่สามารถสรุปปัญหาได้';
    } catch (error) {
      console.error('Error analyzing issue:', error);
      return 'ไม่สามารถสรุปปัญหาได้';
    }
  }

  private async sendOTPEmail(email: string, otp: string, name: string): Promise<boolean> {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const mailOptions = {
        from: `"IT Support Jastel" <${process.env.SMTP_USER || 'no-reply@jastel.co.th'}>`,
        to: email,
        subject: 'รหัส OTP สำหรับยืนยันตัวตน LINE IT Support Jastel',
        html: `
          <h3>เรียนคุณ ${name},</h3>
          <p>รหัส OTP สำหรับการลงทะเบียนเข้าใช้งานระบบ LINE IT Support Jastel ของคุณคือ: <strong>${otp}</strong></p>
          <p>รหัสจะมีอายุการใช้งาน 5 นาที กรุณานำรหัส 6 หลักนี้ไปกรอกในแชท LINE</p>
          <br>
          <p>หากคุณไม่ได้ทำการลงทะเบียน กรุณาเพิกเฉยต่ออีเมลฉบับนี้</p>
          <p>Best Regards,<br>IT Support Team</p>
        `,
      };

      await transporter.sendMail(mailOptions);
      return true;
    } catch (error) {
      console.error('Error sending OTP email:', error);
      return false;
    }
  }

  private async saveOrUpdateUser(userId: string, payload: {
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

  private async showLoadingAnimation(chatId: string, loadingSeconds: number = LOADING_SECONDS): Promise<void> {
    try {
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (!token) return;

      const response = await this.fetchWithTimeout(
        'https://api.line.me/v2/bot/chat/loading/start',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            chatId,
            loadingSeconds,
          }),
        },
        10000,
      );

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error('Loading animation failed:', response.status, body);
      }
    } catch (error) {
      console.error('Error showing loading animation:', error);
    }
  }

  async handleFollow(event: FollowEvent): Promise<MessageAPIResponseBase | undefined | void> {
    const replyToken = event.replyToken;
    const userId = event.source.userId;

    if (!userId) {
      console.warn('No userId found in follow event');
      return;
    }

    try {
      const user = await User.findOne({ lineUserId: userId });

      if (!user) {
        this.setRegistrationState(userId, { step: 1 });

        return this.replyText(
          replyToken,
          'สวัสดีครับ! ฉันคือ AI ด้าน IT Support ของบริษัท Jastel Network ยินดีให้บริการครับ 👋\n\n' +
            '⚠️ ประกาศสำคัญก่อนใช้งาน:\n' +
            '- ระบบนี้ออกแบบมาเพื่อพนักงานในบริษัทที่ได้รับการยืนยันตัวตนแล้วเท่านั้น\n' +
            '- การสนทนาจะถูกบันทึกเพื่อนำไปปรับปรุงระบบและให้บริการในภายหลัง\n' +
            '- รบกวนสอบถามเฉพาะปัญหาที่เกี่ยวข้องกับงานด้าน IT Support เท่านั้น\n\n' +
            'กรุณาลงทะเบียนเพื่อเริ่มใช้งาน โดยพิมพ์ **รหัสพนักงาน** หรือ **Email** อย่างใดอย่างหนึ่ง เพื่อให้ระบบตรวจสอบครับ:',
        );
      }

      return this.replyTextWithQuickReply(
        replyToken,
        `ยินดีต้อนรับกลับมาครับคุณ ${user.name}! มีปัญหาเรื่อง IT สอบถามเข้ามาได้เลยครับ 😊\n\nกรุณากดปุ่มเพื่อเริ่มสนทนาใหม่ 👇`,
        [
          { label: '👤 ติดต่อเจ้าหน้าที่', text: 'ติดต่อเจ้าหน้าที่' },
          { label: '🚀 เริ่มสนทนาใหม่', text: '/start' },
        ],
      );
    } catch (error) {
      console.error('Error handling follow event:', error);
      return this.replyText(replyToken, 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
    }
  }

  async handleMessage(event: MessageEvent): Promise<MessageAPIResponseBase | undefined | void> {
    const replyToken = event.replyToken;
    const source = event.source;

    const userId =
      source.type === 'user'
        ? source.userId
        : source.type === 'group'
          ? source.userId
          : undefined;

    if (!userId) {
      console.warn('No userId found in event source');
      return;
    }

    const message = event.message;

    try {
      const user = await User.findOne({ lineUserId: userId });

      if (!user) {
        if (message.type !== 'text') {
          return this.replyText(replyToken, 'กรุณาลงทะเบียนด้วยข้อความก่อนนะครับ');
        }
        return this.handleRegistration(replyToken, userId, (message as TextEventMessage).text);
      }

      const waitingRatingConv = await this.getLatestConversationByStatuses(userId, ['waiting_rating']);
      if (waitingRatingConv) {
        if (message.type !== 'text') {
          return this.replyText(replyToken, 'กรุณาให้คะแนนเป็นตัวเลข 1-5 ครับ');
        }
        return this.handleRating(replyToken, userId, (message as TextEventMessage).text, waitingRatingConv);
      }

      const waitingEscalationConv = await this.getLatestConversationByStatuses(userId, ['waiting_escalation_issue']);
      if (waitingEscalationConv) {
        if (message.type !== 'text') {
          return this.replyText(replyToken, 'กรุณาระบุปัญหาเป็นข้อความครับ');
        }
        return this.escalateToSupport(
          replyToken,
          userId,
          (message as TextEventMessage).text,
          waitingEscalationConv,
        );
      }

      switch (message.type) {
        case 'text':
          return this.handleTextMessage(replyToken, userId, (message as TextEventMessage).text);

        case 'image':
          return this.handleImageMessage(replyToken, userId, message as ImageEventMessage);

        case 'file':
          return this.handleFileMessage(replyToken, userId, message as FileEventMessage);

        case 'sticker':
          return this.replyTextWithQuickReply(
            replyToken,
            'สวัสดีครับ หากต้องการให้ดูแลเรื่อง IT Support รบกวนกดปุ่มเพื่อเริ่มสนทนาใหม่ได้เลยครับ 😊 👇',
            [{ label: '🚀 เริ่มสนทนาใหม่', text: '/start' }],
          );

        default:
          return this.replyText(replyToken, 'ขออภัยครับ รองรับเฉพาะข้อความ, รูปภาพ และไฟล์ PDF เท่านั้น');
      }
    } catch (error) {
      console.error('Error handling message:', error);
      return this.replyText(replyToken, 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
    }
  }

  async handleTextMessage(
    replyToken: string,
    userId: string,
    rawText: string,
  ): Promise<MessageAPIResponseBase | undefined> {
    const text = this.sanitizeFreeText(rawText);
    const normalizedLower = text.toLowerCase().trim();

    if (text === '/start' || text === 'เริ่มสนทนาใหม่') {
      return this.startNewConversation(replyToken, userId);
    }

    const greetingKeywords = [
      'hi',
      'hello',
      'สวัสดี',
      'สวัสดีครับ',
      'สวัสดีค่ะ',
      'ดีจ้า',
      'ดีครับ',
      'ดีค่ะ',
      'ทัก',
      'ดีค้าบ',
      'สวัสดีค้าบ',
      'หวัดดี',
    ];

    if (greetingKeywords.includes(normalizedLower)) {
      return this.replyTextWithQuickReply(
        replyToken,
        'สวัสดีครับ หากต้องการให้ดูแลเรื่อง IT Support รบกวนกดปุ่มเพื่อเริ่มสนทนาใหม่ได้เลยครับ 😊 👇',
        [{ label: '🚀 เริ่มสนทนาใหม่', text: '/start' }],
      );
    }

    if (text === '/help' || text === 'ช่วยเหลือ') {
      return this.showHelp(replyToken);
    }

    if (text === 'แก้ได้แล้ว') {
      const activeConv = await this.getLatestConversationByStatuses(userId, ['active']);
      if (activeConv) {
        return this.handleRating(replyToken, userId, text, activeConv);
      }
    }

    if (text === 'ยังแก้ไม่ได้') {
      return this.escalateToSupport(replyToken, userId);
    }

    const escalateKeywords = [
      'ติดต่อเจ้าหน้าที่',
      'escalate',
      'ติดต่อit',
      'ติดต่อ it',
      'เรียกit',
      'เรียก it',
      'คุยกับคน',
      'คุยกับเจ้าหน้าที่',
      'แจ้งit',
      'แจ้ง it',
      'เรียกแอดมิน',
      'เรียก admin',
    ];

    if (escalateKeywords.some((keyword) => normalizedLower.includes(keyword))) {
      const activeConv = await this.getLatestConversationByStatuses(userId, ['active']);
      if (activeConv && activeConv.messages.length > 0) {
        return this.escalateToSupport(replyToken, userId, undefined, activeConv);
      }
      return this.promptForEscalationIssue(replyToken, userId);
    }

    return this.handleConversation(replyToken, userId, text);
  }

  async handleImageMessage(
    replyToken: string,
    userId: string,
    message: ImageEventMessage,
  ): Promise<MessageAPIResponseBase | undefined> {
    try {
      const imageStream = (await this.client.getMessageContent(message.id)) as AsyncIterable<Buffer>;
      const imageData = await this.streamToBuffer(imageStream);
      const base64Image = imageData.toString('base64');

      await this.showLoadingAnimation(userId, LOADING_SECONDS);

      const analysisResult = (await geminiService.analyzeImage(base64Image)) as GeminiImageAnalysis;

      let conversation = await this.getActiveConversation(userId);
      if (!conversation) {
        conversation = await this.createNewConversation(userId, 'active');
      }

      conversation.messages.push({
        role: 'user',
        content: `[ส่งรูปภาพ] ${analysisResult.description || 'รูปภาพที่เกี่ยวข้องกับปัญหา'}`,
        timestamp: this.now(),
      });

      conversation.messages.push({
        role: 'assistant',
        content: analysisResult.response,
        timestamp: this.now(),
      });

      await conversation.save();
      return this.replyText(replyToken, analysisResult.response);
    } catch (error) {
      console.error('Error handling image:', error);
      return this.replyText(replyToken, 'ไม่สามารถประมวลผลรูปภาพได้ กรุณาลองใหม่อีกครั้ง');
    }
  }

  async handleFileMessage(
    replyToken: string,
    userId: string,
    message: FileEventMessage,
  ): Promise<MessageAPIResponseBase | undefined> {
    try {
      const fileName = message.fileName || '';

      if (!fileName.toLowerCase().endsWith('.pdf')) {
        return this.replyText(replyToken, 'รองรับเฉพาะไฟล์ PDF เท่านั้นครับ');
      }

      const fileStream = (await this.client.getMessageContent(message.id)) as AsyncIterable<Buffer>;
      const fileData = await this.streamToBuffer(fileStream);
      const base64File = fileData.toString('base64');

      await this.showLoadingAnimation(userId, LOADING_SECONDS);

      const analysisResult = (await geminiService.analyzePDF(base64File, fileName)) as GeminiPdfAnalysis;

      let conversation = await this.getActiveConversation(userId);
      if (!conversation) {
        conversation = await this.createNewConversation(userId, 'active');
      }

      conversation.messages.push({
        role: 'user',
        content: `[ส่งไฟล์ PDF] ${fileName}`,
        timestamp: this.now(),
      });

      conversation.messages.push({
        role: 'assistant',
        content: analysisResult.response,
        timestamp: this.now(),
      });

      await conversation.save();
      return this.replyText(replyToken, analysisResult.response);
    } catch (error) {
      console.error('Error handling file:', error);
      return this.replyText(replyToken, 'ไม่สามารถประมวลผลไฟล์ได้ กรุณาลองใหม่อีกครั้ง');
    }
  }

  async handleRegistration(
    replyToken: string,
    userId: string,
    rawText: string,
  ): Promise<MessageAPIResponseBase | undefined> {
    const text = this.sanitizeFreeText(rawText);
    let state = this.getRegistrationState(userId);

    if (!state) {
      this.setRegistrationState(userId, { step: 1 });
      return this.replyText(
        replyToken,
        'สวัสดีครับ! ฉันคือ AI ด้าน IT Support ของบริษัท Jastel Network ยินดีให้บริการครับ 👋\n\n' +
          '⚠️ ประกาศสำคัญก่อนใช้งาน:\n' +
          '- ระบบนี้ออกแบบมาเพื่อตรวจสอบสิทธิ์ผ่านฐานข้อมูลพนักงานบริษัท\n' +
          '- การสนทนาจะถูกบันทึกเพื่อนำไปปรับปรุงระบบและให้บริการในภายหลัง\n' +
          '- รบกวนสอบถามเฉพาะปัญหาที่เกี่ยวข้องกับงานด้าน IT Support เท่านั้น\n\n' +
          'กรุณาลงทะเบียนเพื่อเริ่มใช้งาน โดยพิมพ์ **รหัสพนักงาน** หรือ **Email** อย่างใดอย่างหนึ่ง เพื่อให้ระบบตรวจสอบครับ:',
      );
    }

    if (state.step === 1) {
      const searchQuery = text.toLowerCase().trim();

      try {
        await this.showLoadingAnimation(userId, 10);

        const response = await this.fetchWithTimeout('http://172.16.1.16:3000/api/employees/list', { method: 'GET' }, 15000);
        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }

        const jsonResponse: any = await response.json();
        const employees: any[] = Array.isArray(jsonResponse) ? jsonResponse : (jsonResponse.data || []);

        const match = employees.find((emp: any) => {
          const empId = emp.emp_id ? emp.emp_id.toLowerCase() : '';
          const empEmail = emp.email ? emp.email.toLowerCase() : '';
          
          return empId === searchQuery || empEmail === searchQuery;
        });

        if (match) {
          if (!match.email) {
            return this.replyText(replyToken, '❌ ไม่พบข้อมูล Email ในระบบพนักงานของคุณ ทำให้ไม่สามารถส่งรหัส OTP ได้ กรุณาติดต่อฝ่าย IT Support เพื่อดำเนินการครับ');
          }

          const existingUser = await User.findOne({ 
            $or: [
              { employeeId: match.emp_id },
              { email: match.email }
            ]
          });
          if (existingUser && existingUser.lineUserId !== userId) {
            return this.replyText(replyToken, '❌ ข้อมูลรหัสพนักงานหรือ Email นี้ ถูกนำไปลงทะเบียนเชื่อมโยงกับ LINE ID อื่นแล้ว หากมีข้อผิดพลาดกรุณาติดต่อฝ่าย IT Support ครับ');
          }

          const payload = {
            name: match.full_name || 'ไม่ระบุชื่อ',
            employeeId: match.emp_id || 'ไม่ระบุรหัสพนักงาน',
            department: match.department_name || match.division_name || 'ไม่ระบุแผนก',
            email: match.email,
            phone: match.phone ? this.normalizePhone(match.phone) : undefined,
          };

          const otp = Math.floor(100000 + Math.random() * 900000).toString();
          const emailSuccess = await this.sendOTPEmail(match.email, otp, match.full_name || 'พนักงาน');

          if (!emailSuccess) {
            return this.replyText(replyToken, '❌ ไม่สามารถส่งรหัส OTP ไปยังอีเมลของคุณได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง หรือติดต่อ IT Support เพื่อให้แอดมินตรวจสอบครับ');
          }

          this.setRegistrationState(userId, {
            step: 2,
            otp,
            otpExpiresAt: Date.now() + 5 * 60 * 1000,
            tempPayload: payload,
          });

          return this.replyText(
            replyToken,
            `✉️ ระบบได้ส่งรหัส OTP 6 หลักไปที่อีเมล **${match.email}** เรียบร้อยแล้ว\n\nกรุณานำรหัส OTP มาพิมพ์ตอบกลับภายใน 5 นาทีครับ\n\n(หากต้องการยกเลิก ให้พิมพ์ "ยกเลิก")`
          );

        } else {
          return this.replyText(
            replyToken,
            '❌ ขออภัย ไม่พบข้อมูลของคุณในระบบของบริษัทครับ\n\nกรุณาลองตรวจสอบและค้นหาอีกครั้ง โดยพิมพ์ **รหัสพนักงาน** หรือ **Email** สำหรับยืนยันตัวตนให้ถูกต้องครับ'
          );
        }
      } catch (error) {
        console.error('API validation error:', error);
        return this.replyText(replyToken, 'ระบบตรวจสอบข้อมูลขัดข้อง กรุณาลองใหม่อีกครั้งในภายหลังครับ');
      }
    }

    if (state.step === 2) {
      if (text.trim() === 'ยกเลิก') {
        this.clearRegistrationState(userId);
        return this.replyText(replyToken, 'ยกเลิกการลงทะเบียนแล้วครับ หากต้องการเริ่มใหม่ ให้พิมพ์ รหัสพนักงาน หรือ Email อีกครั้งเพื่อลงทะเบียนครับ');
      }

      const tempPayload = (state as any).tempPayload;
      if (!state.otp || !state.otpExpiresAt || !tempPayload) {
        this.setRegistrationState(userId, { step: 1 });
        return this.replyText(replyToken, 'เซสชั่นการลงทะเบียนหมดอายุหรือไม่ถูกต้อง กรุณาเริ่มพิมพ์ รหัสพนักงาน หรือ Email ใหม่อีกครั้งครับ');
      }

      if (Date.now() > state.otpExpiresAt) {
        this.setRegistrationState(userId, { step: 1 });
        return this.replyText(replyToken, '❌ รหัส OTP หมดอายุการใช้งานแล้ว (เกิน 5 นาที) กรุณาเริ่มพิมพ์ รหัสพนักงาน หรือ Email ใหม่อีกครั้งครับ');
      }

      if (text.trim() !== state.otp) {
        return this.replyText(replyToken, '❌ รหัส OTP ไม่ถูกต้อง กรุณาตรวจสอบแล้วลองพิมพ์ใหม่อีกครั้ง (หรือพิมพ์ "ยกเลิก" เพื่อทำรายการใหม่)');
      }

      await this.saveOrUpdateUser(userId, tempPayload);
      this.clearRegistrationState(userId);

      const contactInfo = `ชื่อ: ${tempPayload.name}\nรหัสพนักงาน: ${tempPayload.employeeId}\nแผนก: ${tempPayload.department}${tempPayload.email ? `\nEmail: ${tempPayload.email}` : ''}${tempPayload.phone ? `\nเบอร์ติดต่อ: ${tempPayload.phone}` : ''}`;

      return this.replyTextWithQuickReply(
        replyToken,
        `ลงทะเบียนสำเร็จ! ✅ ยืนยันตัวตนผ่าน OTP เรียบร้อยครับ\n\n${contactInfo}\n\nพิมพ์คำถามหรือปัญหาที่ต้องการความช่วยเหลือได้เลยครับ 😊\n\nหรือพิมพ์ /help เพื่อดูคำแนะนำ`,
        [{ label: '👤 ติดต่อเจ้าหน้าที่', text: 'ติดต่อเจ้าหน้าที่' }],
      );
    }
  }

  async handleConversation(
    replyToken: string,
    userId: string,
    text: string,
  ): Promise<MessageAPIResponseBase | undefined> {
    let conversation = await this.getActiveConversation(userId);

    if (!conversation) {
      conversation = await this.createNewConversation(userId, 'active');
    }

    conversation.messages.push({
      role: 'user',
      content: text,
      timestamp: this.now(),
    });
    await conversation.save();

    await this.showLoadingAnimation(userId, LOADING_SECONDS);

    const aiResponseRaw = await geminiService.chat(conversation.messages);
    const { content: aiResponse, type: responseType } =
      geminiService.parseResponse(aiResponseRaw) as ParsedGeminiResponse;

    conversation.messages.push({
      role: 'assistant',
      content: aiResponse,
      timestamp: this.now(),
    });

    if (responseType === 'OUT_OF_SCOPE') {
      conversation.nonItCount = (conversation.nonItCount || 0) + 1;
      await conversation.save();

      if (conversation.nonItCount >= 3) {
        return this.replyText(
          replyToken,
          '⚠️ คำเตือน: ระบบตรวจพบว่าคุณถามข้อมูลที่ไม่เกี่ยวข้องกับ IT Support ครบจำนวนครั้งที่กำหนดแล้ว\n\nกรุณาสอบถามเฉพาะปัญหาที่เกี่ยวกับ IT (เช่น คอมพิวเตอร์เสีย, โปรแกรมใช้งานไม่ได้) เท่านั้นครับ',
        );
      }

      return this.replyText(replyToken, aiResponse);
    }

    conversation.nonItCount = 0;
    await conversation.save();

    if (responseType === 'IT_INFO') {
      return this.replyText(replyToken, aiResponse);
    }

    return this.replyTextWithQuickReply(
      replyToken,
      `${aiResponse}\n\n---\nแก้ปัญหาได้แล้วหรือยังครับ?`,
      [
        { label: '✅ แก้ได้แล้ว', text: 'แก้ได้แล้ว' },
        { label: '❌ ยังไม่ได้', text: 'ยังแก้ไม่ได้' },
        { label: '👤 ติดต่อเจ้าหน้าที่', text: 'ติดต่อเจ้าหน้าที่' },
      ],
    );
  }

  async handleRating(
    replyToken: string,
    userId: string,
    text: string,
    conversation: ConversationDoc,
  ): Promise<MessageAPIResponseBase | undefined> {
    if (text === 'แก้ได้แล้ว') {
      conversation.resolved = true;
      conversation.status = 'waiting_rating';
      await conversation.save();

      return this.replyTextWithQuickReply(
        replyToken,
        'ยินดีด้วยครับ! 🎉\n\nกรุณาให้คะแนนความพึงพอใจ:',
        [
          { label: '⭐', text: '1' },
          { label: '⭐⭐', text: '2' },
          { label: '⭐⭐⭐', text: '3' },
          { label: '⭐⭐⭐⭐', text: '4' },
          { label: '⭐⭐⭐⭐⭐', text: '5' },
        ],
      );
    }

    if (text === 'ยังแก้ไม่ได้') {
      return this.escalateToSupport(replyToken, userId, undefined, conversation);
    }

    if (!this.isStrictRating(text)) {
      return this.replyText(replyToken, 'กรุณาเลือกคะแนน 1-5 ดาว');
    }

    const rating = Number(text.trim());
    conversation.rating = rating;
    conversation.issue = await this.analyzeIssueSafe(conversation.messages);
    conversation.status = 'closed';
    conversation.closedAt = this.now();
    await conversation.save();

    return this.replyTextWithQuickReply(
      replyToken,
      `ขอบคุณสำหรับการให้คะแนน! ${'⭐'.repeat(rating)}\n\nหากมีปัญหาอื่น ๆ สามารถสอบถามได้ตลอดเวลาครับ 😊\n\nกรุณากดปุ่มเพื่อเริ่มสนทนาใหม่ 👇`,
      [{ label: '🚀 เริ่มสนทนาใหม่', text: '/start' }],
    );
  }

  async escalateToSupport(
    replyToken: string,
    userId: string,
    userText?: string,
    existingConv?: ConversationDoc,
  ): Promise<MessageAPIResponseBase | undefined> {
    const user = await User.findOne({ lineUserId: userId });

    const conversation =
      existingConv ||
      (await this.getLatestConversationByStatuses(userId, [
        'active',
        'waiting_rating',
        'waiting_escalation_issue',
      ]));

    let issueSummary = 'ไม่ระบุปัญหา';

    if (conversation) {
      if (userText && !this.shouldSkipAddingAsIssueContext(userText)) {
        conversation.messages.push({
          role: 'user',
          content: this.sanitizeFreeText(userText),
          timestamp: this.now(),
        });
      }

      conversation.escalated = true;
      conversation.issue = await this.analyzeIssueSafe(conversation.messages);
      conversation.status = 'closed';
      conversation.closedAt = this.now();
      await conversation.save();

      issueSummary = conversation.issue || issueSummary;
    } else if (userText && !this.shouldSkipAddingAsIssueContext(userText)) {
      issueSummary = this.sanitizeFreeText(userText);
    }

    if (issueSummary.includes('NON_IT_ISSUE')) {
      if (conversation && conversation.status !== 'closed') {
        await this.closeConversation(conversation);
      }

      return this.replyTextWithQuickReply(
        replyToken,
        '❌ ขออภัยครับ ระบบตรวจพบว่าเรื่องที่คุณต้องการแจ้ง ไม่ได้เกี่ยวข้องกับ IT Support ตามที่ระบุไว้ในเงื่อนไขการใช้งาน\n\nระบบจึงไม่สามารถส่งเรื่องนี้ไปยังเจ้าหน้าที่ได้ครับ 🙏\n\nกรุณากดปุ่มเพื่อเริ่มการสนทนาใหม่ 👇',
        [{ label: '🚀 เริ่มสนทนาใหม่', text: '/start' }],
      );
    }

    const adminGroupId = process.env.ADMIN_GROUP_ID;
    let deliveredToAdmin = false;

    if (adminGroupId && user) {
      const adminMessage =
        `🚨 แจ้งเตือนปัญหาใหม่!\n\n` +
        `ผู้แจ้ง: ${user.name}\n` +
        `รหัสพนักงาน: ${user.employeeId}\n` +
        `แผนก: ${user.department}\n` +
        `เบอร์ติดต่อ: ${user.phone || 'ไม่ได้ระบุ'}\n\n` +
        `ปัญหาที่พบ:\n${issueSummary}`;

      try {
        await this.client.pushMessage(adminGroupId, {
          type: 'text',
          text: this.truncateText(adminMessage),
        });
        deliveredToAdmin = true;
      } catch (error) {
        console.error('Error sending message to admin group:', error);
      }
    } else {
      console.warn('ADMIN_GROUP_ID is not set in environment or user not found.');
    }

    if (deliveredToAdmin) {
      return this.replyTextWithQuickReply(
        replyToken,
        `ระบบได้ส่งเรื่องของ ${user ? `คุณ ${user.name}` : 'คุณ'} ไปยังเจ้าหน้าที่ IT Support เรียบร้อยแล้วครับ\n\nเจ้าหน้าที่จะรีบตรวจสอบและติดต่อกลับโดยเร็วที่สุดครับ 🙏\n\nกรุณากดปุ่มเพื่อเริ่มการสนทนาใหม่ 👇`,
        [{ label: '🚀 เริ่มสนทนาใหม่', text: '/start' }],
      );
    }

    return this.replyTextWithQuickReply(
      replyToken,
      `ระบบรับเรื่องของ ${user ? `คุณ ${user.name}` : 'คุณ'} ไว้แล้วครับ แต่ยังส่งต่อไปยังเจ้าหน้าที่อัตโนมัติไม่สำเร็จ\n\nกรุณาตรวจสอบ ADMIN_GROUP_ID / สิทธิ์บอท / การเชิญบอทเข้ากลุ่ม แล้วลองใหม่อีกครั้งครับ`,
      [{ label: '🚀 เริ่มสนทนาใหม่', text: '/start' }],
    );
  }

  async promptForEscalationIssue(
    replyToken: string,
    userId: string,
  ): Promise<MessageAPIResponseBase | undefined> {
    let conversation = await this.getActiveConversation(userId);

    if (!conversation) {
      conversation = await this.createNewConversation(userId, 'waiting_escalation_issue');
    } else {
      conversation.status = 'waiting_escalation_issue';
      await conversation.save();
    }

    return this.replyText(
      replyToken,
      'ต้องการแจ้งเรื่องอะไรครับ พิมพ์รายละเอียดทิ้งไว้ได้เลยครับ',
    );
  }

  async startNewConversation(
    replyToken: string,
    userId: string,
  ): Promise<MessageAPIResponseBase | undefined> {
    const openConvs = (await Conversation.find({
      lineUserId: userId,
      status: { $in: ['active', 'waiting_rating', 'waiting_escalation_issue'] },
    })) as ConversationDoc[];

    for (const conv of openConvs) {
      conv.status = 'closed';
      conv.closedAt = this.now();
      await conv.save();
    }

    return this.replyTextWithQuickReply(
      replyToken,
      'ยินดีให้บริการครับ\nหากคุณกำลังประสบปัญหาในการใช้งานคอมพิวเตอร์ ระบบเครือข่าย อีเมล หรือโปรแกรมต่าง ๆ สามารถแจ้งรายละเอียดปัญหาเข้ามาได้เลยครับ ผมพร้อมช่วยตรวจสอบและแนะนำขั้นตอนการแก้ไขเบื้องต้นให้ครับ',
      [{ label: '👤 ติดต่อเจ้าหน้าที่', text: 'ติดต่อเจ้าหน้าที่' }],
    );
  }

  async showHelp(replyToken: string): Promise<MessageAPIResponseBase | undefined> {
    const helpText = `📋 คำแนะนำการใช้งาน

🔹 สอบถามปัญหา IT ได้เลย เช่น:
- ลืมรหัสผ่าน
- อินเทอร์เน็ตช้า
- เครื่องพิมพ์ไม่ทำงาน
- ติดตั้งโปรแกรม

🔹 คำสั่งพิเศษ:
- /start : เริ่มสนทนาใหม่
- /help : แสดงคำแนะนำนี้

🔹 ติดต่อเจ้าหน้าที่:
พิมพ์ "ติดต่อเจ้าหน้าที่"`;

    return this.replyText(replyToken, helpText);
  }
}