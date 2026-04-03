import { Client, MessageEvent, FollowEvent, MessageAPIResponseBase, TextEventMessage, ImageEventMessage, FileEventMessage } from '@line/bot-sdk';
import { MessagingService } from './line/messaging.js';
import { ConversationService } from './line/conversation.js';
import { RegistrationService } from './line/registration.js';
import * as mainHandlers from './line/handlers/main.js';
import * as registrationHandlers from './line/handlers/registration.js';
import * as supportHandlers from './line/handlers/support.js';
import * as mediaHandlers from './line/handlers/media.js';
import User from '../models/User.js';

export class LineService {
  private messaging: MessagingService;
  private conversation: ConversationService;
  private registration: RegistrationService;

  constructor(private client: Client) {
    this.messaging = new MessagingService(client);
    this.conversation = new ConversationService();
    this.registration = new RegistrationService();
  }

  async handleFollow(event: FollowEvent): Promise<MessageAPIResponseBase | undefined | void> {
    return mainHandlers.handleFollow(event, this.messaging, this.conversation, this.registration);
  }

  async handleMessage(event: MessageEvent): Promise<MessageAPIResponseBase | undefined | void> {
    const replyToken = event.replyToken;
    const source = event.source;

    const userId = source.type === 'user' ? source.userId : source.type === 'group' ? source.userId : undefined;
    if (!userId) {
      console.warn('No userId found in event source');
      return;
    }

    // ⏳ Show thinking UI for all incoming requests (Both AI and Bot)
    await this.messaging.showLoadingAnimation(userId);

    const message = event.message;

    try {
      const user = await User.findOne({ lineUserId: userId });

      // 🚨 Registration Flow
      if (!user) {
        if (message.type !== 'text') {
          let state = this.registration.getState(userId);
          if (!state) {
            return registrationHandlers.handleRegistration(replyToken, userId, '', this.messaging, this.registration, this.conversation);
          }
          if (state.step === 1) {
            return this.messaging.replyText(replyToken, 'กรุณาพิมพ์ **รหัสพนักงาน** หรือ **Email** เป็นข้อความ เพื่อตรวจสอบสิทธิ์ครับ');
          } else {
            return this.messaging.replyText(replyToken, 'กรุณาพิมพ์รหัส OTP 6 หลักเป็นข้อความครับ (หรือพิมพ์ "ยกเลิก" เพื่อทำรายการใหม่)');
          }
        }
        return registrationHandlers.handleRegistration(replyToken, userId, (message as TextEventMessage).text, this.messaging, this.registration, this.conversation);
      }

      // 🚨 Special Status Handlers
      const waitingRatingConv = await this.conversation.getLatestConversationByStatuses(userId, ['waiting_rating']);
      if (waitingRatingConv) {
        if (message.type !== 'text') {
          return this.messaging.replyText(replyToken, 'กรุณาให้คะแนนเป็นตัวเลข 1-5 ครับ');
        }
        return supportHandlers.handleRating(replyToken, userId, (message as TextEventMessage).text, waitingRatingConv, this.messaging, this.conversation);
      }

      const waitingEscalationConv = await this.conversation.getLatestConversationByStatuses(userId, ['waiting_escalation_issue', 'waiting_troubleshoot_confirm']);
      if (waitingEscalationConv) {
        if (message.type !== 'text') {
          return this.messaging.replyText(replyToken, 'กรุณาระบุปัญหาเป็นข้อความครับ');
        }
        return supportHandlers.escalateToSupport(replyToken, userId, (message as TextEventMessage).text, waitingEscalationConv, this.messaging, this.conversation);
      }

      // 🚨 Main Message Type Routing
      switch (message.type) {
        case 'text':
          return mainHandlers.handleTextMessage(replyToken, userId, (message as TextEventMessage).text, this.messaging, this.conversation);

        case 'image':
          return mediaHandlers.handleImageMessage(replyToken, userId, message as ImageEventMessage, this.client, this.messaging, this.conversation);

        case 'file':
          return mediaHandlers.handleFileMessage(replyToken, userId, message as FileEventMessage, this.client, this.messaging, this.conversation);

        case 'sticker':
          return this.messaging.replyTextWithQuickReply(
            replyToken,
            'สวัสดีครับ หากต้องการให้ดูแลเรื่อง IT Support รบกวนกดปุ่มเพื่อเริ่มสนทนาใหม่ได้เลยครับ 😊 👇',
            [{ label: '🚀 เริ่มสนทนาใหม่', text: '/start' }],
          );

        default:
          return this.messaging.replyText(replyToken, 'ขออภัยครับ รองรับเฉพาะข้อความ, รูปภาพ และไฟล์ PDF เท่านั้น');
      }
    } catch (error) {
      console.error('Error handling message:', error);
      return this.messaging.replyText(replyToken, 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
    }
  }
}