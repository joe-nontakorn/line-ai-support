import { MessageAPIResponseBase } from '@line/bot-sdk';
import { MessagingService } from '../messaging.js';
import { ConversationService } from '../conversation.js';
import { ConversationDoc } from '../types.js';
import geminiService from '../../gemini.js';
import Ticket from '../../../models/Ticket.js';

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
    if ((issueSummary === 'ไม่ระบุ' || issueSummary === 'ไม่สามารถสรุปปัญหาได้') && conversationToUpdate.issue && conversationToUpdate.issue !== 'ไม่ระบุ') {
      issueSummary = conversationToUpdate.issue;
    }
  } else if (conversationToUpdate.issue && conversationToUpdate.issue !== 'ไม่ระบุ') {
    issueSummary = conversationToUpdate.issue;
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
    // ไม่บันทึก issue เพื่อไม่ให้ขึ้นในรายงานสรุปปัญหา IT
    await conversationToUpdate.save();

    return messaging.replyTextWithQuickReply(
      replyToken,
      'ขออภัยครับ ระบบนี้รองรับเฉพาะปัญหาด้าน IT Support เท่านั้น\n\nหากมีปัญหาด้าน IT สอบถามได้เลยครับ 😊',
      [{ label: '🚀 เริ่มสนทนาใหม่', text: '/start' }],
    );
  }

  // 🔎 แจ้งเรื่องอุปกรณ์ฮาร์ดแวร์
  if (conversationToUpdate.status !== 'waiting_hardware_confirm') {
    const hardwareKeywords = ['เครื่องเสีย', 'เปิดไม่ติด', 'จอดำ', 'จอฟ้า', 'อุปกรณ์', 'จอ', 'เมาส์', 'คีย์บอร์ด', 'ฮาร์ดแวร์', 'เครื่อง', 'พัง', 'ปริ้น', 'สแกน', 'printer', 'scanner'];
    const isHardware = hardwareKeywords.some(kw => issueSummary.toLowerCase().includes(kw));

    if (isHardware) {
      try {
        const res = await fetch(`http://172.16.1.16:3000/api/assets/search?employee_name=${encodeURIComponent(user.name)}`);
        if (res.ok) {
          const result = await res.json() as any;
          if (result.success && result.data && result.data.length > 0) {
            const assets = result.data.slice(0, 5); // Limit to 5 assets for quick replies
            
            conversationToUpdate.status = 'waiting_hardware_confirm';
            conversationToUpdate.assetInfo = JSON.stringify(assets); // Save array
            await conversationToUpdate.save();

            if (assets.length === 1) {
              const asset = assets[0];
              const assetStr = `${asset.brand} ${asset.model} (S/N: ${asset.serial_no})`;
              return messaging.replyTextWithQuickReply(
                replyToken,
                `ระบบตรวจพบว่าคุณใช้งานเครื่อง ${assetStr}\nปัญหาเกี่ยวข้องกับอุปกรณ์นี้ใช่หรือไม่ครับ?`,
                [
                  { label: '✅ ใช่', text: 'ใช่ เกี่ยวกับเครื่องนี้' },
                  { label: '❌ ไม่ใช่', text: 'ไม่ใช่เครื่องนี้' }
                ]
              );
            } else {
              // Multiple assets
              const quickReplies = assets.map((a: any) => ({
                label: `✅ ${a.brand} ${a.serial_no}`.substring(0, 20),
                text: `ใช่ เกี่ยวกับเครื่อง S/N: ${a.serial_no}`
              }));
              quickReplies.push({ label: '❌ ไม่ใช่สักเครื่อง', text: 'ไม่ใช่เครื่องนี้' });
              
              const listStr = assets.map((a: any, i: number) => `${i + 1}. ${a.brand} ${a.model}\n   S/N: ${a.serial_no}`).join('\n\n');
              return messaging.replyTextWithQuickReply(
                replyToken,
                `ระบบตรวจพบว่าคุณมีอุปกรณ์หลายรายการ ปัญหาเกี่ยวข้องกับเครื่องใดครับ?\n\n${listStr}`,
                quickReplies
              );
            }
          }
        }
      } catch (err) {
        console.error('Error fetching asset info:', err);
      }
    }
  }

  // ✅ ปิดการสนทนาและบันทึกข้อมูล
  conversationToUpdate.status = 'closed';
  conversationToUpdate.escalated = true;
  conversationToUpdate.issue = issueSummary;
  await conversationToUpdate.save();

  let hardwareDetails = '';
  if (conversationToUpdate.assetInfo) {
    try {
      const assetData = JSON.parse(conversationToUpdate.assetInfo);
      if (assetData && !Array.isArray(assetData)) {
        hardwareDetails = `\n💻 อุปกรณ์: ${assetData.brand} ${assetData.model} (S/N: ${assetData.serial_no})`;
      }
    } catch(e) {}
  }

  // ✅ แจ้ง Admin Group (เฉพาะปัญหา IT ที่มีการระบุชัดเจน)
  const adminGroupId = process.env.ADMIN_GROUP_ID;

  // บันทึกข้อมูลลง MongoDB ตามรูปแบบ
  const newTicket = new Ticket({
    name: user.name,
    employeeId: user.employeeId,
    department: user.department,
    email: user.email || 'ไม่ระบุ',
    phone: user.phone || 'ไม่ระบุ',
    issueSummary: issueSummary + hardwareDetails
  });
  await newTicket.save();

  if (adminGroupId) {
    const adminMessage =
      `🚨 มีการแจ้งเคสใหม่จากพนักงาน\n\n` +
      `👤 ชื่อ: ${user.name}\n` +
      `🆔 รหัสพนักงาน: ${user.employeeId}\n` +
      `📁 แผนก: ${user.department}\n` +
      `📧 Email: ${user.email || 'ไม่ระบุ'}\n` +
      `📞 เบอร์ติดต่อ: ${user.phone || 'ไม่ระบุ'}\n\n` +
      `📝 สรุปปัญหา: ${issueSummary}${hardwareDetails}`;

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
