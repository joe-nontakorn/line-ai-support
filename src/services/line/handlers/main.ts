// src/services/line/handlers/main.ts
import { FollowEvent, MessageAPIResponseBase } from '@line/bot-sdk';
import { MessagingService } from '../messaging.js';
import { ConversationService } from '../conversation.js';
import { RegistrationService } from '../registration.js';
import { GREETING_KEYWORDS, ESCALATE_KEYWORDS } from '../constants.js';
import { handleRating, promptForRating, promptForEscalationIssue, escalateToSupport } from './support.js';
import geminiService from '../../gemini.js';
import { LOADING_SECONDS } from '../constants.js';
import Ticket from '../../../models/Ticket.js';

const apiAsset = process.env.API_ASSET || 'http://172.16.1.16:3000/api';

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
        '- รบกวนสอบถามเฉพาะปัญหาที่เกี่ยวข้องกับงานด้าน IT Support เท่านั้น\n' +
        '- 📌 คุณสามารถส่ง **รูปภาพหน้าจอปัญหา** หรือ **ไฟล์ต่าง ๆ (เช่น PDF)** ให้ AI วิเคราะห์ได้เลยครับ\n\n' +
        'กรุณาลงทะเบียนเพื่อเริ่มใช้งาน โดยพิมพ์ **รหัสพนักงาน** หรือ **Email** อย่างใดอย่างหนึ่ง เพื่อให้ระบบตรวจสอบครับ:'
      );
    }

    // 🚨 Block Inactive Users
    if (user.isActive === false) {
      return messaging.replyText(
        replyToken,
        '❌ ขออภัยครับ บัญชีของคุณถูกระงับการใช้งานเนื่องจากสถานะพนักงานไม่เป็นปกติ (Resigned) หากมีข้อผิดพลาดกรุณาติดต่อฝ่าย IT Support ครับ'
      );
    }

    return messaging.replyTextWithQuickReply(
      replyToken,
      `ยินดีต้อนรับกลับมาครับคุณ ${user.name}! มีปัญหาเรื่อง IT สอบถามเข้ามาได้เลยครับ 😊\n\n📌 สามารถแนบส่ง **รูปภาพแคปหน้าจอ** หรือ **ไฟล์ PDF/เอกสารต่าง ๆ** แจ้งปัญหาได้เลยครับ\n\nกรุณากดปุ่มเพื่อเริ่มสนทนาใหม่ 👇`,
      [{ label: '🚀 เริ่มสนทนาใหม่', text: 'เริ่มสนทนาใหม่' }],
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

  // ✅ ตรวจสอบการยืนยันปิดเคสจาก User
  const confirmMatch = text.match(/ยืนยันปิดเคส\s+(IT-[A-Z0-9]+)/i);
  if (confirmMatch) {
    const ticketId = confirmMatch[1].toUpperCase();
    const ticket = await Ticket.findOne({ ticketId });
    if (ticket && ticket.status === 'waiting_user_confirm') {
      ticket.status = 'resolved';
      ticket.resolvedAt = new Date();
      ticket.statusHistory.push({
        status: 'resolved',
        changedAt: new Date(),
        changedBy: 'User (System)',
        comment: 'User confirmed the resolve.'
      });
      await ticket.save();

      // พยายามหาการสนทนาล่าสุดที่เกี่ยวข้อง
      let conv = await conversationService.getLatestConversationByStatuses(userId, ['active', 'waiting_escalation_issue', 'waiting_hardware_confirm', 'waiting_troubleshoot_confirm']);
      
      if (conv) {
        conv.resolved = true;
        conv.status = 'waiting_rating';
        conv.issue = ticket.issueSummary.split('\n')[0]; // Link rating to the actual issue summary
        await conv.save();
      } else {
        // 🚨 กรณีไม่พบเซสชั่นเดิม (เช่น หมดอายุ) ให้สร้างใหม่เพื่อใช้รับคะแนน (Rating) เสมอ
        conv = await conversationService.createNewConversation(userId, 'waiting_rating');
        conv.resolved = true;
        conv.issue = ticket.issueSummary.split('\n')[0]; // Link rating to the actual issue summary
        await conv.save();
      }

      // บังคับให้แสดงการประเมินคะแนนทุกครั้ง
      return promptForRating(replyToken, userId, conv, messaging, conversationService);
    }
  }

  // ✅ ตรวจสอบกรณี User แจ้งว่ายังเสียอยู่
  const persistsMatch = text.match(/เคส\s+(IT-[A-Z0-9]+)\s+ยังเสียอยู่/i);
  if (persistsMatch) {
    const ticketId = persistsMatch[1].toUpperCase();
    const ticket = await Ticket.findOne({ ticketId });
    if (ticket && ticket.status === 'waiting_user_confirm') {
      ticket.status = 'in_progress';
      ticket.statusHistory.push({
        status: 'in_progress',
        changedAt: new Date(),
        changedBy: 'User (System)',
        comment: 'User reported that the issue persists.'
      });
      await ticket.save();

      // แจ้งห้อง Admin (ใช้ MessagingService ช่วยได้ถ้ามี function ให้บริการ)
      // ในที่นี้สมมติว่า admin group id เก็บใน env
      const adminGroupId = process.env.ADMIN_GROUP_ID;
      if (adminGroupId) {
        await messaging.pushText(adminGroupId, `⚠️ User แจ้งว่าเคส ${ticketId} ยังแก้ไขไม่สำเร็จ! กรุณาตรวจสอบและติดต่อผู้ประกอบการอีกครั้ง\n👤 ผู้แจ้ง: ${ticket.name}\n📝 ปัญหา: ${ticket.issueSummary}`);
      }

      return messaging.replyText(
        replyToken,
        `รับทราบครับ! ระบบได้แจ้งเจ้าหน้าที่ IT ให้ทราบแล้วว่าปัญหายังไม่ได้รับการแก้ไขในเคส ${ticketId}\n\nเจ้าหน้าที่จะรีบทบทวนและดำเนินการให้ใหม่โดยด่วนครับ ขออภัยในความไม่สะดวกครับ 🙏`
      );
    }
  }

  // ตรวจสอบว่าผู้ใช้พิมพ์ถามสถานะ Ticket หรือไม่ (เช่น IT-A1B2C3 หรือ TIC-2026...)
  const ticketMatch = text.match(/(?:IT-[A-Z0-9]+|TIC-\d{8}-\d{3})/i);
  if (ticketMatch) {
    const ticketId = ticketMatch[0].toUpperCase();
    const ticket = await Ticket.findOne({ ticketId });
    if (ticket) {
      let statusText = 'รอดำเนินการ (Pending)';
      if (ticket.status === 'in_progress') statusText = 'กำลังดำเนินการ 🔧';
      else if (ticket.status === 'resolved') statusText = 'แก้ไขสำเร็จแล้ว ✨';

      let replyMsg = `📊 สถานะ Ticket: ${ticketId}\n\n📝 รายละเอียด: ${ticket.issueSummary}\n📌 สถานะปัจจุบัน: ${statusText}`;

      if (ticket.status === 'resolved' && ticket.resolutionComment) {
        replyMsg += `\n✅ วิธีแก้ไข: ${ticket.resolutionComment}`;
      }

      return messaging.replyTextWithQuickReply(
        replyToken,
        replyMsg,
        [{ label: '🚀 เริ่มสนทนาใหม่', text: 'เริ่มสนทนาใหม่' }]
      );
    }
  }

  const isDeviceQuery =
    /(เช็ค|ตรวจสอบ|ดู)?\s*(อุปกรณ์|เครื่อง|คอม|คอมพิวเตอร์|โน๊ตบุ๊ค|ทรัพย์สิน|device)\s*(ของฉัน|ของผม|ของหนู|ของพี่|ที่มี|ที่ครอบครอง|ที่ใช้อยู่|ที่ถืออยู่)/i.test(normalizedLower) ||
    /(ครอบครอง|มี).*(อุปกรณ์|เครื่อง|คอม|คอมพิวเตอร์|โน๊ตบุ๊ค).*(กี่เครื่อง|อะไรบ้าง|กี่อัน)/i.test(normalizedLower) ||
    /my\s*devices?/i.test(normalizedLower) ||
    /(เช็ค|ตรวจสอบ)\s*(อุปกรณ์|เครื่อง|คอม|สเปค)/i.test(normalizedLower) ||
    normalizedLower.includes('ครอบครอง');

  if (isDeviceQuery) {
    const user = await conversationService.getUser(userId);
    if (user) {
      await messaging.showLoadingAnimation(userId, LOADING_SECONDS);
      try {
        const apiUrl = `${apiAsset}/assets/search?employee_name=${encodeURIComponent(user.name)}`;
        const res = await fetch(apiUrl);
        if (res.ok) {
          const result = await res.json() as any;
          if (result.success && result.data && result.data.length > 0) {
            let assets = result.data.filter((a: any) => {
              const status = (a.status || '').toLowerCase();
              return status !== 'retired' && status !== 'disposed';
            });

            if (assets.length > 0) {
              const msgParts = [`💻 อุปกรณ์ของคุณ ${user.name} ในระบบมีดังนี้:`];
              assets.forEach((a: any, index: number) => {
                const loc = a.location_name ? `\n   📍 สถานที่: ${a.location_name}` : '';
                let warrantyInfo = '';
                if (a.warranty_expiry) {
                  const expiryDate = new Date(a.warranty_expiry);
                  const now = new Date();
                  if (expiryDate < now) {
                    warrantyInfo = '\n   🛡️ ประกัน: หมดแล้ว';
                  } else {
                    const diffDays = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                    if (diffDays >= 365) {
                      const years = Math.floor(diffDays / 365);
                      const months = Math.floor((diffDays % 365) / 30);
                      warrantyInfo = `\n   🛡️ ประกัน: เหลือ ${years} ปี ${months > 0 ? months + ' เดือน' : ''}`.trimEnd();
                    } else if (diffDays >= 30) {
                      const months = Math.floor(diffDays / 30);
                      const days = diffDays % 30;
                      warrantyInfo = `\n   🛡️ ประกัน: เหลือ ${months} เดือน ${days > 0 ? days + ' วัน' : ''}`.trimEnd();
                    } else {
                      warrantyInfo = `\n   🛡️ ประกัน: เหลือ ${diffDays} วัน`;
                    }
                  }
                }
                msgParts.push(`${index + 1}. ${a.brand} ${a.model}\n   ประเภท: ${a.type_name}\n   S/N: ${a.serial_no}${loc}${warrantyInfo}`);
              });

              return messaging.replyTextWithQuickReply(
                replyToken,
                msgParts.join('\n\n'),
                [{ label: '🚀 เริ่มสนทนาใหม่', text: 'เริ่มสนทนาใหม่' }]
              );
            }
          }
          return messaging.replyTextWithQuickReply(
            replyToken,
            'ไม่พบอุปกรณ์ที่ลงทะเบียนภายใต้ชื่อของคุณในระบบครับ 📭',
            [{ label: '🚀 เริ่มสนทนาใหม่', text: 'เริ่มสนทนาใหม่' }]
          );
        }
      } catch (err) {
        console.error('Error fetching user devices:', err);
        return messaging.replyText(
          replyToken,
          'ขออภัยครับ ไม่สามารถดึงข้อมูลอุปกรณ์ได้ในขณะนี้ กรุณาลองใหม่อีกครั้งภายหลังครับ 😥'
        );
      }
    }
  }

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
        { label: '🚀 เริ่มสนทนาใหม่', text: 'เริ่มสนทนาใหม่' },
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
        { label: '🚀 เริ่มสนทนาใหม่', text: 'เริ่มสนทนาใหม่' },
        { label: '👤 ติดต่อเจ้าหน้าที่', text: 'ติดต่อเจ้าหน้าที่' },
      ],
    );
  }

  // ✅ ตรวจสอบการให้คะแนน (ถ้าอยู่ในสถานะรอคะแนน)
  const ratingConv = await conversationService.getLatestConversationByStatuses(userId, ['waiting_rating']);
  if (ratingConv && /^[1-5]$/.test(normalizedLower)) {
    return handleRating(replyToken, userId, normalizedLower, ratingConv, messaging, conversationService);
  }

  if (text === 'แก้ได้แล้ว' || text === 'ให้คะแนนคำตอบ') {
    const activeConv = await conversationService.getLatestConversationByStatuses(userId, ['active', 'waiting_troubleshoot_confirm', 'waiting_hardware_confirm']);
    if (activeConv) {
      activeConv.resolved = true;
      await activeConv.save();
      return promptForRating(replyToken, userId, activeConv, messaging, conversationService);
    }
  }

  if (text === 'ยังแก้ไม่ได้') {
    const activeConv = await conversationService.getLatestConversationByStatuses(userId, ['active', 'waiting_troubleshoot_confirm', 'waiting_hardware_confirm']);
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
          } catch (e) { }
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

  if (text === 'ติดต่อเจ้าหน้าที่') {
    const activeConv = await conversationService.getLatestConversationByStatuses(userId, ['active', 'waiting_troubleshoot_confirm', 'waiting_hardware_confirm']);
    return escalateToSupport(replyToken, userId, undefined, activeConv, messaging, conversationService);
  }

  // Handle generalized conversation
  let conversation = await conversationService.getActiveConversation(userId);
  if (!conversation) {
    conversation = await conversationService.createNewConversation(userId, 'active');
  }

  await conversationService.appendUserMessage(conversation, text);
  await messaging.showLoadingAnimation(userId, LOADING_SECONDS);

  // 🎫 ดึงข้อมูล Ticket ของผู้ใช้งานรายนี้เพื่อส่งเป็น Context ให้ AI
  const user = await conversationService.getUser(userId);
  let userTicketsContext = '';
  if (user) {
    const userTickets = await Ticket.find({ employeeId: user.employeeId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    if (userTickets.length > 0) {
      userTicketsContext = userTickets.map(t => {
        let statusTh = 'รอดำเนินการ';
        if (t.status === 'in_progress') statusTh = 'กำลังดำเนินการ';
        if (t.status === 'waiting_user_confirm') statusTh = 'รอคุณยืนยันผล';
        if (t.status === 'resolved') statusTh = 'แก้ไขเรียบร้อยแล้ว';

        return `- [${t.ticketId}] เรื่อง: ${t.issueSummary.split('\n')[0]} | สถานะ: ${statusTh} | วันที่: ${t.reportedAt.toLocaleDateString('th-TH')}`;
      }).join('\n');
    }
  }

  const aiResponseRaw = await geminiService.chat(conversation.messages, { 
    userKey: userId,
    userTicketsContext: userTicketsContext || 'ไม่พบประวัติ Ticket ของคุณในระบบ'
  });
  const { content: aiResponse, type: responseType, topic: responseTopic } = geminiService.parseResponse(aiResponseRaw);

  await conversationService.appendAssistantMessage(conversation, aiResponse);

  if (responseTopic && responseTopic !== 'ไม่ระบุ') {
    if (!conversation.issue || conversation.issue === '' || conversation.issue === 'ไม่ระบุ' || conversation.issue === 'ไม่สามารถสรุปปัญหาได้') {
      conversation.issue = responseTopic;
      await conversation.save();
    }
  }

  let quickReplies: any[] = [];
  if (aiResponse.includes('it@jastel.co.th')) {
    quickReplies = [{ label: '🚀 เริ่มสนทนาใหม่', text: 'เริ่มสนทนาใหม่' }];
  } else {
    quickReplies = [{ label: '👤 ติดต่อเจ้าหน้าที่', text: 'ติดต่อเจ้าหน้าที่' }];
    if (responseType === 'IT_PROBLEM') {
      quickReplies.unshift({ label: '✅ แก้ได้แล้ว', text: 'แก้ได้แล้ว' });
    } else if (responseType === 'IT_INFO') {
      quickReplies.unshift({ label: '🚀 เริ่มสนทนาใหม่', text: 'เริ่มสนทนาใหม่' });
      quickReplies.unshift({ label: '📊 ให้คะแนนคำตอบ', text: 'ให้คะแนนคำตอบ' });
    } else if (responseType === 'OUT_OF_SCOPE') {
      quickReplies.unshift({ label: '🚀 เริ่มสนทนาใหม่', text: 'เริ่มสนทนาใหม่' });
    }
  }

  return messaging.replyTextWithQuickReply(replyToken, aiResponse, quickReplies);
}
