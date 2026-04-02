// src/services/line/handlers/main.ts
import { FollowEvent, MessageAPIResponseBase } from '@line/bot-sdk';
import { MessagingService } from '../messaging.js';
import { ConversationService } from '../conversation.js';
import { RegistrationService } from '../registration.js';
import { GREETING_KEYWORDS, ESCALATE_KEYWORDS } from '../constants.js';
import { handleRating, promptForRating, promptForEscalationIssue, escalateToSupport } from './support.js';
import geminiService from '../../gemini.js';
import { LOADING_SECONDS } from '../constants.js';

export async function handleFollow(
  event: FollowEvent,
  messaging: MessagingService,
  conversationService: ConversationService,
  registration: RegistrationService
): Promise<MessageAPIResponseBase | undefined | void> {
  const replyToken = event.replyToken;
  const userId = event.source.userId;
  if (!userId) return;

  try {
    const user = await conversationService.getUser(userId);

    if (!user) {
      registration.setState(userId, { step: 1 });
      return messaging.replyText(
        replyToken,
        'สวัสดีครับ! ฉันคือ AI ด้าน IT Support ของบริษัท Jastel Network ยินดีให้บริการครับ 👋\n\n' +
        '⚠️ ประกาศสำคัญก่อนใช้งาน:\n' +
        '- ระบบนี้ออกแบบมาเพื่อพนักงานในบริษัทที่ได้รับการยืนยันตัวตนแล้วเท่านั้น\n' +
        '- การสนทนาจะถูกบันทึกเพื่อนำไปปรับปรุงระบบและให้บริการในภายหลัง\n' +
        '- รบกวนสอบถามเฉพาะปัญหาที่เกี่ยวข้องกับงานด้าน IT Support เท่านั้น\n\n' +
        'กรุณาลงทะเบียนเพื่อเริ่มใช้งาน โดยพิมพ์ **รหัสพนักงาน** หรือ **Email** อย่างใดอย่างหนึ่ง เพื่อให้ระบบตรวจสอบครับ:'
      );
    }

    return messaging.replyTextWithQuickReply(
      replyToken,
      `ยินดีต้อนรับกลับมาครับคุณ ${user.name}! มีปัญหาเรื่อง IT สอบถามเข้ามาได้เลยครับ 😊\n\nกรุณากดปุ่มเพื่อเริ่มสนทนาใหม่ 👇`,
      [
        { label: '👤 ติดต่อเจ้าหน้าที่', text: 'ติดต่อเจ้าหน้าที่' },
        { label: '🚀 เริ่มสนทนาใหม่', text: '/start' },
      ],
    );
  } catch (error) {
    console.error('Error handling follow event:', error);
    return messaging.replyText(replyToken, 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
  }
}

export async function handleTextMessage(
  replyToken: string,
  userId: string,
  text: string,
  messaging: MessagingService,
  conversationService: ConversationService
): Promise<MessageAPIResponseBase | undefined> {
  const normalizedLower = text.toLowerCase().trim();

  if (text === '/start' || text === 'เริ่มสนทนาใหม่') {
    // ปิดการสนทนาทั้งหมดที่ยังค้างอยู่ก่อนเสมอ
    await conversationService.closeAllActiveConversations(userId);
    await conversationService.createNewConversation(userId, 'active');
    return messaging.replyTextWithQuickReply(
      replyToken,
      'เริ่มต้นการสนทนาใหม่แล้วครับ 😊\nพิมพ์ปัญหาหรือเรื่องที่ต้องการสอบถามได้เลยครับ\n\nหรือกดปุ่มด้านล่างเพื่อติดต่อเจ้าหน้าที่โดยตรง 👇',
      [{ label: '👤 ติดต่อเจ้าหน้าที่', text: 'ติดต่อเจ้าหน้าที่' }],
    );
  }

  if (GREETING_KEYWORDS.includes(normalizedLower)) {
    return messaging.replyTextWithQuickReply(
      replyToken,
      'สวัสดีครับ หากต้องการให้ดูแลเรื่อง IT Support รบกวนกดปุ่มเพื่อเริ่มสนทนาใหม่ได้เลยครับ 😊 👇',
      [
        { label: '🚀 เริ่มสนทนาใหม่', text: '/start' },
        { label: '👤 ติดต่อเจ้าหน้าที่', text: 'ติดต่อเจ้าหน้าที่' },
      ],
    );
  }

  if (text === '/help' || text === 'ช่วยเหลือ') {
    return messaging.replyTextWithQuickReply(
      replyToken,
      '🛠️ คำแนะนำการใช้งานบอท IT Support\n\n' +
      '• พิมพ์ปัญหาที่คุณพบสั้นๆ เช่น "เน็ตช้า", "เข้าอีเมลไม่ได้"\n' +
      '• ส่งรูปภาพหน้าจอที่มีปัญหา เพื่อความแม่นยำในการวิเคราะห์\n' +
      '• หากต้องการติดต่อเจ้าหน้าที่โดยตรง กดปุ่มด้านล่าง\n' +
      '• หากต้องการเริ่มคุยใหม่ ให้กด "เริ่มสนทนาใหม่"\n\n' +
      'ยินดีให้บริการครับ 😊',
      [
        { label: '🚀 เริ่มสนทนาใหม่', text: '/start' },
        { label: '👤 ติดต่อเจ้าหน้าที่', text: 'ติดต่อเจ้าหน้าที่' },
      ],
    );
  }

  if (text === 'แก้ได้แล้ว') {
    const activeConv = await conversationService.getLatestConversationByStatuses(userId, ['active']);
    if (activeConv) {
      return promptForRating(replyToken, userId, activeConv, messaging, conversationService);
    }
  }

  if (text === 'ยังแก้ไม่ได้') {
    // ดึง conversation ที่มีอยู่เพื่อให้ระบบวิเคราะห์สรุปปัญหาได้
    const activeConv = await conversationService.getLatestConversationByStatuses(userId, ['active']);
    return escalateToSupport(replyToken, userId, undefined, activeConv, messaging, conversationService);
  }

  if (text.startsWith('ใช่ เกี่ยวกับเครื่อง') || text === 'ไม่ใช่เครื่องนี้') {
    const hwConv = await conversationService.getLatestConversationByStatuses(userId, ['waiting_hardware_confirm']);
    if (hwConv) {
      if (text === 'ไม่ใช่เครื่องนี้') {
        hwConv.assetInfo = undefined;
        await hwConv.save();
      } else {
        if (hwConv.assetInfo) {
          try {
            const assets = JSON.parse(hwConv.assetInfo);
            if (Array.isArray(assets)) {
              if (text === 'ใช่ เกี่ยวกับเครื่องนี้') {
                hwConv.assetInfo = JSON.stringify(assets[0]);
              } else {
                const match = text.match(/S\/N:\s*(.+)$/);
                if (match && match[1]) {
                  const selected = assets.find((a: any) => a.serial_no === match[1]);
                  hwConv.assetInfo = JSON.stringify(selected || assets[0]);
                } else {
                  hwConv.assetInfo = JSON.stringify(assets[0]);
                }
              }
              await hwConv.save();
            }
          } catch(e) {}
        }
      }
      return escalateToSupport(replyToken, userId, undefined, hwConv, messaging, conversationService);
    }
  }

  if (ESCALATE_KEYWORDS.some((keyword) => normalizedLower.includes(keyword))) {
    const activeConv = await conversationService.getLatestConversationByStatuses(userId, ['active']);
    if (activeConv && activeConv.messages.length > 0) {
      return escalateToSupport(replyToken, userId, undefined, activeConv, messaging, conversationService);
    }
    return promptForEscalationIssue(replyToken, userId, messaging, conversationService);
  }

  // Handle generalized conversation
  let conversation = await conversationService.getActiveConversation(userId);
  if (!conversation) {
    conversation = await conversationService.createNewConversation(userId, 'active');
  }

  await conversationService.appendUserMessage(conversation, text);
  await messaging.showLoadingAnimation(userId, LOADING_SECONDS);

  const aiResponseRaw = await geminiService.chat(conversation.messages);
  const { content: aiResponse, type: responseType, topic: responseTopic } = geminiService.parseResponse(aiResponseRaw);

  await conversationService.appendAssistantMessage(conversation, aiResponse);

  if (responseTopic && responseTopic !== 'ไม่ระบุ') {
    if (!conversation.issue || conversation.issue === '' || conversation.issue === 'ไม่ระบุ' || conversation.issue === 'ไม่สามารถสรุปปัญหาได้') {
      conversation.issue = responseTopic;
      await conversation.save();
    }
  }

  const quickReplies = [{ label: '👤 ติดต่อเจ้าหน้าที่', text: 'ติดต่อเจ้าหน้าที่' }];
  if (responseType === 'IT_PROBLEM' || responseType === 'IT_INFO') {
    quickReplies.unshift({ label: '✅ แก้ได้แล้ว', text: 'แก้ได้แล้ว' });
    quickReplies.unshift({ label: '❌ ยังแก้ไม่ได้', text: 'ยังแก้ไม่ได้' });
  } else if (responseType === 'OUT_OF_SCOPE') {
    quickReplies.unshift({ label: '🚀 เริ่มสนทนาใหม่', text: '/start' });
  }

  return messaging.replyTextWithQuickReply(replyToken, aiResponse, quickReplies);
}
