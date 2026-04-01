import { MessageAPIResponseBase } from '@line/bot-sdk';
import { MessagingService } from '../messaging.js';
import { ConversationService } from '../conversation.js';
import { ConversationDoc } from '../types.js';
import geminiService from '../../gemini.js';

export async function promptForRating(
  replyToken: string,
  userId: string,
  conversation: ConversationDoc,
  messaging: MessagingService,
  conversationService: ConversationService
): Promise<MessageAPIResponseBase | undefined> {
  conversation.status = 'waiting_rating';
  await conversation.save();

  return messaging.replyTextWithQuickReply(
    replyToken,
    'ยอดเยี่ยมเลยครับ! 🎉 เพื่อเป็นกำลังใจและปรับปรุงบริการ รบกวนให้คะแนนความพึงพอใจด้วยครับ\n(1 = น้อยที่สุด, 5 = มากที่สุด)',
    [
      { label: '⭐ 1', text: '1' },
      { label: '⭐ 2', text: '2' },
      { label: '⭐ 3', text: '3' },
      { label: '⭐ 4', text: '4' },
      { label: '⭐ 5', text: '5' },
    ]
  );
}

export async function handleRating(
  replyToken: string,
  userId: string,
  text: string,
  conversation: ConversationDoc,
  messaging: MessagingService,
  conversationService: ConversationService
): Promise<MessageAPIResponseBase | undefined> {
  const rating = parseInt(text);
  if (isNaN(rating) || rating < 1 || rating > 5) {
    return messaging.replyTextWithQuickReply(
      replyToken,
      'กรุณาให้คะแนนเป็นตัวเลข 1-5 ครับ',
      [
        { label: '⭐ 1', text: '1' },
        { label: '⭐ 2', text: '2' },
        { label: '⭐ 3', text: '3' },
        { label: '⭐ 4', text: '4' },
        { label: '⭐ 5', text: '5' },
      ]
    );
  }

  conversation.rating = rating;
  conversation.status = 'closed';
  conversation.resolved = true;
  await conversation.save();

  return messaging.replyTextWithQuickReply(
    replyToken,
    'ขอบคุณสำหรับคะแนนประเมินครับ! หากมีปัญหาอื่นๆ สอบถามได้เสมอครับ 😊',
    [{ label: '🚀 เริ่มสนทนาใหม่', text: '/start' }],
  );
}

export async function promptForEscalationIssue(
  replyToken: string,
  userId: string,
  messaging: MessagingService,
  conversationService: ConversationService
): Promise<MessageAPIResponseBase | undefined> {
  await conversationService.createNewConversation(userId, 'waiting_escalation_issue');
  return messaging.replyText(replyToken, 'กรุณาระบุปัญหาหรือเรื่องที่ต้องการติดต่อเจ้าหน้าที่ (อธิบายให้ชัดเจน เช่น อาการที่พบ, โปรแกรมที่มีปัญหา) ครับ:');
}

export async function escalateToSupport(
  replyToken: string,
  userId: string,
  text: string | undefined,
  conversation: ConversationDoc | null,
  messaging: MessagingService,
  conversationService: ConversationService
): Promise<MessageAPIResponseBase | undefined> {
  const user = await conversationService.getUser(userId);
  if (!user) return messaging.replyText(replyToken, 'ไม่พบข้อมูลผู้ใช้ กรุณาลองใหม่อีกครั้ง');

  let issueSummary = 'ไม่ระบุ';
  let conversationToUpdate = conversation;

  if (!conversationToUpdate) {
    conversationToUpdate = await conversationService.createNewConversation(userId, 'active');
  }

  if (text) {
    issueSummary = text.trim();
    await conversationService.appendUserMessage(conversationToUpdate, text);
  } else if (conversationToUpdate.messages.length > 0) {
    issueSummary = await conversationService.analyzeIssueSafe(conversationToUpdate.messages);
  }

  // ❌ ไม่ส่ง admin ถ้าไม่มีการระบุปัญหา
  if (issueSummary === 'ไม่ระบุ' || issueSummary.trim() === '' || issueSummary === 'ไม่สามารถสรุปปัญหาได้') {
    return messaging.replyText(
      replyToken,
      '⚠️ กรุณาระบุปัญหาหรืออาการที่พบให้ชัดเจนก่อนนะครับ เจ้าหน้าที่จะได้เข้าใจและช่วยได้อย่างถูกต้อง\n\nเช่น "เชื่อมต่อ VPN ไม่ได้", "เปิด Outlook แล้ว Error", "Printer ไม่ทำงาน"'
    );
  }

  // ❌ ตรวจสอบกับ AI ว่าเป็นปัญหา IT จริงหรือไม่
  const isItRelated = await checkITRelatedWithAI(issueSummary, conversationToUpdate);
  if (!isItRelated) {
    // ปิดการสนทนาแล้วแจ้งผู้ใช้
    conversationToUpdate.status = 'closed';
    conversationToUpdate.issue = issueSummary;
    await conversationToUpdate.save();

    return messaging.replyTextWithQuickReply(
      replyToken,
      'ขออภัยครับ ระบบนี้รองรับเฉพาะปัญหาด้าน IT Support เท่านั้น\n\nหากมีปัญหาด้าน IT สอบถามได้เลยครับ 😊',
      [{ label: '🚀 เริ่มสนทนาใหม่', text: '/start' }],
    );
  }

  // ✅ ปิดการสนทนาและบันทึกข้อมูล
  conversationToUpdate.status = 'closed';
  conversationToUpdate.escalated = true;
  conversationToUpdate.issue = issueSummary;
  await conversationToUpdate.save();

  // ✅ แจ้ง Admin Group (เฉพาะปัญหา IT ที่มีการระบุชัดเจน)
  const adminGroupId = process.env.ADMIN_GROUP_ID;
  if (adminGroupId) {
    const adminMessage =
      `🚨 มีการแจ้งเคสใหม่จากพนักงาน\n\n` +
      `👤 ชื่อ: ${user.name}\n` +
      `🆔 รหัสพนักงาน: ${user.employeeId}\n` +
      `📁 แผนก: ${user.department}\n` +
      `📧 Email: ${user.email || 'ไม่ระบุ'}\n` +
      `📞 เบอร์ติดต่อ: ${user.phone || 'ไม่ระบุ'}\n\n` +
      `📝 สรุปปัญหา: ${issueSummary}`;

    await messaging.pushText(adminGroupId, adminMessage);
  }

  // ✅ ตอบกลับผู้ใช้พร้อมปุ่มเริ่มสนทนาใหม่
  return messaging.replyTextWithQuickReply(
    replyToken,
    'รับทราบครับ! ✅ ระบบได้แจ้งเจ้าหน้าที่ IT Support ให้เรียบร้อยแล้ว\n\nเจ้าหน้าที่จะติดต่อกลับหาคุณโดยเร็วที่สุดครับ 🙏\n\n─────────────────\nหากต้องการแจ้งปัญหาเพิ่มเติม กดปุ่มเพื่อเริ่มการสนทนาใหม่ได้เลยครับ 👇',
    [{ label: '🚀 เริ่มสนทนาใหม่', text: '/start' }],
  );
}

/**
 * ตรวจสอบว่าปัญหาเกี่ยวข้องกับ IT หรือไม่
 * ใช้ Gemini AI วิเคราะห์ + pattern matching เป็น fallback
 */
async function checkITRelatedWithAI(issueSummary: string, conversation: ConversationDoc): Promise<boolean> {
  // Step 1: ตรวจสอบ pattern ที่ชัดเจนว่าไม่ใช่ IT (fast path)
  const nonItPatterns = [
    'NON_IT',
    'OUT_OF_SCOPE',
    'ไม่เกี่ยวกับ IT',
    'นอกขอบเขต',
    'ไม่ใช่ปัญหา IT',
  ];

  for (const pattern of nonItPatterns) {
    if (issueSummary.toUpperCase().includes(pattern.toUpperCase())) {
      return false;
    }
  }

  // Step 2: ตรวจสอบจากประวัติสนทนา ถ้า AI ตอบว่าไม่เกี่ยวกับ IT ทุกครั้ง
  const assistantMessages = conversation.messages.filter(m => m.role === 'assistant');
  if (assistantMessages.length > 0) {
    const outOfScopeCount = assistantMessages.filter(m =>
      m.content.includes('[OUT_OF_SCOPE]') ||
      m.content.includes('ไม่ใช่ปัญหา IT') ||
      m.content.includes('นอกขอบเขต') ||
      m.content.includes('นอกเหนือจากขอบเขต')
    ).length;

    if (outOfScopeCount > 0 && outOfScopeCount === assistantMessages.length) {
      return false;
    }
  }

  // Step 3: ส่งให้ Gemini วิเคราะห์ว่าเป็นปัญหา IT จริงหรือไม่
  try {
    const aiResult = await geminiService.analyzeIssue(
      [{ role: 'user', content: issueSummary }]
    );

    // ถ้า AI บอกว่า NON_IT_ISSUE → ไม่ใช่ IT
    if (aiResult.toUpperCase().includes('NON_IT')) {
      console.log(`[IT-Filter] Rejected non-IT issue: "${issueSummary}" → AI: "${aiResult}"`);
      return false;
    }

    return true;
  } catch (error) {
    // ถ้า AI ล้มเหลว ให้ผ่านไปก่อน (fail-open) เพื่อไม่ให้พลาดเคสจริง
    console.error('[IT-Filter] AI check failed, allowing escalation:', error);
    return true;
  }
}
