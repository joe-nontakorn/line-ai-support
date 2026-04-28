import { Client, MessageEvent, FollowEvent, MessageAPIResponseBase, TextEventMessage, ImageEventMessage, FileEventMessage } from '@line/bot-sdk';
import { MessagingService } from './line/messaging.js';
import { ConversationService } from './line/conversation.js';
import { RegistrationService } from './line/registration.js';
import * as mainHandlers from './line/handlers/main.js';
import * as registrationHandlers from './line/handlers/registration.js';
import * as supportHandlers from './line/handlers/support.js';
import * as mediaHandlers from './line/handlers/media.js';
import User from '../models/User.js';
import { logger } from '../utils/logger.js';

export const imageWaitStates = new Map<string, (text: string | null) => void>();

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
      logger.warn('No userId found in event source');
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

      // 🚨 Sync Active Status from External API (Throttle: once every 12 hours)
      const TWELVE_HOURS = 12 * 60 * 60 * 1000;
      const lastCheck = user.lastStatusCheck ? new Date(user.lastStatusCheck).getTime() : 0;
      
      if (Date.now() - lastCheck > TWELVE_HOURS) {
        try {
          const employeeData = await this.registration.validateEmployee(user.employeeId);
          if (employeeData) {
            user.isActive = employeeData.is_active;
            user.lastStatusCheck = new Date();
            await user.save();
            logger.info(`Synced isActive for user ${user.employeeId}: ${user.isActive}`);
          }
        } catch (err) {
          logger.error(`Error syncing user status for ${user.employeeId}:`, err);
        }
      }

      // 🚨 Block Inactive Users (Resigned)
      if (user.isActive === false) {
        return this.messaging.replyText(
          replyToken,
          '❌ ขออภัยครับ บัญชีของคุณถูกระงับการใช้งานเนื่องจากสถานะพนักงานไม่เป็นปกติ (Resigned) หากมีข้อสงสัยกรุณาติดต่อฝ่าย IT Support ครับ'
        );
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

      // 🔧 สถานะ waiting_hardware_confirm: ถ้า user พิมพ์ข้อความเอง (ไม่ใช่กดปุ่ม) ให้ส่งเข้า escalation
      const waitingHwConv = await this.conversation.getLatestConversationByStatuses(userId, ['waiting_hardware_confirm']);
      if (waitingHwConv && message.type === 'text') {
        const hwText = (message as TextEventMessage).text;
        // ปล่อยให้ข้อความจากปุ่ม quick reply ไป handleTextMessage ตามปกติ
        if (!hwText.startsWith('ใช่ เกี่ยวกับเครื่อง') && hwText !== 'ไม่ใช่เครื่องนี้') {
          return supportHandlers.escalateToSupport(replyToken, userId, hwText, waitingHwConv, this.messaging, this.conversation);
        }
      }

      // 🚨 Main Message Type Routing
      switch (message.type) {
        case 'text': {
          const textMessage = (message as TextEventMessage).text;
          
          if (imageWaitStates.has(userId)) {
            const resolver = imageWaitStates.get(userId)!;
            imageWaitStates.delete(userId); // remove to prevent multiple texts from firing
            resolver(textMessage);
            return; // Halt independent text processing since it's now bound to the image
          }

          return mainHandlers.handleTextMessage(replyToken, userId, textMessage, this.messaging, this.conversation);
        }

        case 'image': {
          // Wait 5 seconds to see if there is an accompanying text message
          const userText = await new Promise<string|null>(resolve => {
            imageWaitStates.set(userId, resolve);
            setTimeout(() => {
              if (imageWaitStates.has(userId)) {
                imageWaitStates.delete(userId);
                resolve(null);
              }
            }, 4000); // Wait 4 seconds for a text
          });
          
          return mediaHandlers.handleImageMessage(replyToken, userId, message as ImageEventMessage, this.client, this.messaging, this.conversation, userText || undefined);
        }

        case 'file':
          return mediaHandlers.handleFileMessage(replyToken, userId, message as FileEventMessage, this.client, this.messaging, this.conversation);

        case 'sticker':
          return this.messaging.replyTextWithQuickReply(
            replyToken,
            'สวัสดีครับ หากต้องการให้ดูแลเรื่อง IT Support รบกวนกดปุ่มเพื่อเริ่มสนทนาใหม่ได้เลยครับ 😊 👇',
            [{ label: '🚀 เริ่มสนทนาใหม่', text: 'เริ่มสนทนาใหม่' }],
          );

        default:
          return this.messaging.replyText(replyToken, 'ขออภัยครับ รองรับเฉพาะข้อความ, รูปภาพ และไฟล์ PDF เท่านั้น');
      }
    } catch (error) {
      logger.error('Error handling message:', error);
      return this.messaging.replyText(replyToken, 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
    }
  }
}