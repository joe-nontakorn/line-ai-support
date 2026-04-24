// src/services/line/handlers/support.ts
import { MessageAPIResponseBase } from '@line/bot-sdk';
import { MessagingService } from '../messaging.js';
import { ConversationService } from '../conversation.js';
import { ConversationDoc } from '../types.js';
import geminiService from '../../gemini.js';
import Ticket from '../../../models/Ticket.js';
import { logger } from '../../../utils/logger.js';

const apiAsset = process.env.API_ASSET || 'http://172.16.1.16:3000/api';

export async function promptForRating(
  replyToken: string,
  userId: string,
  conversation: ConversationDoc,
  messaging: MessagingService,
  conversationService: ConversationService
): Promise<MessageAPIResponseBase | undefined> {
  conversation.status = 'waiting_rating';
  await conversation.save();

  const msgText = 'ยอดเยี่ยมเลยครับ! 🎉 เพื่อเป็นกำลังใจและปรับปรุงบริการ รบกวนให้คะแนนความพึงพอใจด้วยครับ\n(1 = น้อยที่สุด, 5 = มากที่สุด)';
  await conversationService.appendAssistantMessage(conversation, msgText);

  return messaging.replyTextWithQuickReply(
    replyToken,
    msgText,
    [
      { label: '⭐ 1', text: '1' },
      { label: '⭐ 2', text: '2' },
      { label: '⭐ 3', text: '3' },
      { label: '⭐ 4', text: '4' },
      { label: '⭐ 5', text: '5' },
    ],
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
    return messaging.replyText(replyToken, 'รบกวนเลือกคะแนน 1-5 จากปุ่มด้านล่างนะครับ');
  }

  conversation.rating = rating;
  conversation.status = 'closed';
  conversation.closedAt = new Date();
  await conversation.save();

  // อัปเดตคะแนนใน Ticket ล่าสุดของผู้ใช้ (ถ้ามี)
  const lastTicket = await Ticket.findOne({ employeeId: (await conversationService.getUser(userId))?.employeeId }).sort({ reportedAt: -1 });
  if (lastTicket) {
    // @ts-ignore
    lastTicket.rating = rating;
    await lastTicket.save();
  }

  const replyMsg = `ขอบคุณสำหรับคะแนน ${rating} ดาวครับ! 🙏 เราจะนำไปปรับปรุงบริการให้ดียิ่งขึ้นครับ`;
  await conversationService.appendAssistantMessage(conversation, replyMsg);

  return messaging.replyTextWithQuickReply(
    replyToken,
    replyMsg,
    [{ label: '🚀 เริ่มสนทนาใหม่', text: 'เริ่มสนทนาใหม่' }],
  );
}

export async function promptForEscalationIssue(
  replyToken: string,
  userId: string,
  messaging: MessagingService,
  conversationService: ConversationService
): Promise<MessageAPIResponseBase | undefined> {
  const newConv = await conversationService.createNewConversation(userId, 'waiting_escalation_issue');
  const msgText = 'กรุณาระบุปัญหาหรือเรื่องที่ต้องการติดต่อเจ้าหน้าที่ (อธิบายให้ชัดเจน เช่น อาการที่พบ, โปรแกรมที่มีปัญหา) ครับ:';
  await conversationService.appendAssistantMessage(newConv, msgText);
  return messaging.replyText(replyToken, msgText);
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
  let hardwareDetails = '';
  let conversationToUpdate = conversation;

  if (!conversationToUpdate) {
    conversationToUpdate = await conversationService.createNewConversation(userId, 'active');
  }

  if (!conversationToUpdate) return;

  if (text) {
    await conversationService.appendUserMessage(conversationToUpdate, text);
  }

  const isDirectEscalation = conversationToUpdate.status === 'waiting_escalation_issue';
  const userMessages = conversationToUpdate.messages.filter(m => m.role === 'user');

  let category = 'Uncategorized';
  let subCategory = 'Other';
  let isItRelated = true;
  let clarificationNeeded: string | null = null;

  // 1. 🔍 เตรียมข้อมูลเบื้องต้นเพื่อดึง Asset แบบขนาน (เดาจาก keyword)
  const rawText = (text || '').toLowerCase();
  const printerKeywords = ['ปริ้น', 'printer', 'เครื่องพิมพ์', 'สแกน', 'scanner', 'หมึก', 'หมึกพิมพ์'];
  const computerKeywords = ['เครื่องเสีย', 'เปิดไม่ติด', 'จอดำ', 'จอฟ้า', 'คอม', 'โน๊ตบุ๊ค', 'laptop', 'desktop', 'พีซี', 'pc', 'แฟลชไดรฟ์', 'flash drive', 'usb', 'ไฟล์', 'copy', 'คัดลอก'];
  const otherHwKeywords = ['อุปกรณ์', 'จอ', 'เมาส์', 'คีย์บอร์ด', 'ฮาร์ดแวร์', 'พัง', 'monitor', 'keyboard', 'mouse'];

  const isPrinter = printerKeywords.some(kw => rawText.includes(kw));
  const isComputer = computerKeywords.some(kw => rawText.includes(kw));
  const isOtherHw = otherHwKeywords.some(kw => rawText.includes(kw));
  const maybeHardware = isPrinter || isComputer || isOtherHw;

  // 2. 🧠 ดำเนินการวิเคราะห์ AI และ ดึงข้อมูล Asset ไปพร้อมๆ กัน (Parallel)
  const [aiResult, assetResponse] = await Promise.all([
    // AI Analysis
    (isDirectEscalation && userMessages.length === 1 && text)
      ? geminiService.categorizeIssue(text.trim()).then(res => ({ ...res, issueSummary: text.trim(), isITRelated: true, clarificationNeeded: null }))
      : conversationService.analyzeAndCategorizeSafe(conversationToUpdate.messages),
    // Asset Fetching
    maybeHardware
      ? (async () => {
        let apiUrl = `${apiAsset}/assets/search?`;
        if (isPrinter) apiUrl += `type_name=Printer`;
        else apiUrl += `employee_name=${encodeURIComponent(user!.name)}`;
        try {
          const res = await fetch(apiUrl);
          return res.ok ? await res.json() : null;
        } catch { return null; }
      })()
      : Promise.resolve(null)
  ]);

  issueSummary = aiResult.issueSummary;
  category = aiResult.category;
  subCategory = aiResult.subCategory;
  isItRelated = aiResult.isITRelated;
  clarificationNeeded = aiResult.clarificationNeeded;

  // 🛡️ Fallback chain
  if (issueSummary === 'ไม่ระบุ' || issueSummary === 'ไม่สามารถสรุปปัญหาได้') {
    if (conversationToUpdate.issue && conversationToUpdate.issue !== 'ไม่ระบุ') {
      issueSummary = conversationToUpdate.issue;
    } else if (text) {
      issueSummary = text.trim();
    }
  }

  // ❌ ไม่ส่ง admin ถ้าไม่มีการระบุปัญหา
  if (issueSummary === 'ไม่ระบุ' || issueSummary.trim() === '') {
    const errorMsg = '⚠️ กรุณาระบุปัญหาหรืออาการที่พบให้ชัดเจนก่อนนะครับ เพื่อความรวดเร็วในการช่วยเหลือครับ';
    await conversationService.appendAssistantMessage(conversationToUpdate, errorMsg);
    return messaging.replyText(replyToken, errorMsg);
  }

  // ❌ ตรวจสอบความเป็น IT
  if (!isItRelated) {
    conversationToUpdate.status = 'closed';
    await conversationToUpdate.save();
    const rejectMsg = 'ขออภัยครับ ระบบนี้รองรับเฉพาะปัญหาด้าน IT Support เท่านั้นครับ 😊';
    await conversationService.appendAssistantMessage(conversationToUpdate, rejectMsg);
    return messaging.replyTextWithQuickReply(replyToken, rejectMsg, [{ label: '🚀 เริ่มสนทนาใหม่', text: 'เริ่มสนทนาใหม่' }]);
  }

  const isSkip = text?.trim() === 'ข้าม';
  // 3. ❓ ถามย้ำหากข้อมูลไม่พอ
  if (!isSkip && !isDirectEscalation && clarificationNeeded && conversationToUpdate.status !== 'waiting_hardware_confirm' && conversationToUpdate.status !== 'waiting_troubleshoot_confirm') {
    const userMessagesInState = conversationToUpdate.messages.filter(m => m.role === 'user').length;
    if (userMessagesInState <= 1) {
      const clarMsg = `${clarificationNeeded}\n\n(หรือพิมพ์ "ข้าม" เพื่อแจ้งเจ้าหน้าที่ทันที)`;
      await conversationService.appendAssistantMessage(conversationToUpdate, clarMsg);
      return messaging.replyText(replyToken, clarMsg);
    }
  }

  // ถ้าพิมพ์ว่า "ข้าม" ให้ข้ามการกรองรายละเอียด
  if (isSkip) {
    issueSummary = await conversationService.analyzeIssueSafe(
      conversationToUpdate.messages
        .filter(m => m.content !== 'ข้าม')
        .map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp }))
    );
  }

  // 🔎 ประมวลผลข้อมูลอุปกรณ์
  if (!isSkip && !isDirectEscalation && conversationToUpdate.status !== 'waiting_hardware_confirm' && conversationToUpdate.status !== 'waiting_troubleshoot_confirm') {
    if (assetResponse && assetResponse.success && assetResponse.data && assetResponse.data.length > 0) {
      let assets = assetResponse.data.filter((a: any) => {
        const status = (a.status || '').toLowerCase();
        return status !== 'retired' && status !== 'disposed';
      });

      if (isPrinter) {
        assets = assets.filter((a: any) => a.type_name === 'Printer');
      } else if (isComputer) {
        assets = assets.filter((a: any) => a.type_name === 'Laptop' || a.type_name === 'Desktop');
      }

      const summaryLower = issueSummary.toLowerCase();
      if (assets.length > 0) {
        const commonStopWords = ['เครื่อง', 'ไม่', 'ได้', 'ไม่ได้', 'มี', 'ปัญหา', 'แก้', 'ไข', 'แก้ไข', 'ช่วย', 'ครับ', 'ค่ะ', 'ที่', 'ของ', 'และ', 'หรือ', 'กับ', 'ใน', 'จะ'];
        const issueWords = summaryLower
          .replace(/[^\u0E00-\u0E7Fa-z0-9\s]/gi, ' ')
          .split(/\s+/)
          .filter(w => w.length >= 2 && !commonStopWords.includes(w));

        if (issueWords.length > 0 && assets.length > 1) {
          const scoredAssets = assets.map((a: any) => {
            const brand = (a.brand || '').toLowerCase();
            const model = (a.model || '').toLowerCase().replace(/\s+/g, '');
            const desc = (a.description || '').toLowerCase();
            let score = 0;
            for (const word of issueWords) {
              if (brand.includes(word)) score += 3;
              if (model.includes(word)) score += 5;
              if (desc.includes(word)) score += 4;
            }
            return { asset: a, score };
          });
          scoredAssets.sort((a: any, b: any) => b.score - a.score);
          if (scoredAssets[0].score > 0) {
            const maxScore = scoredAssets[0].score;
            assets = scoredAssets.filter((s: any) => s.score >= maxScore * 0.7).map((s: any) => s.asset);
          }
        }

        if (assets.length > 0) {
          assets = assets.slice(0, 12);
          conversationToUpdate.status = 'waiting_hardware_confirm';
          conversationToUpdate.assetInfo = JSON.stringify(assets);
          await conversationToUpdate.save();

          const getAssetLabel = (a: any) => `${a.brand || ''} ${a.model || ''} (${a.location_name || ''})`.substring(0, 15);
          const getAssetDesc = (a: any) => `${a.brand} ${a.model}\n   S/N: ${a.serial_no}${a.location_name ? '\n   📍 ตำแหน่ง: ' + a.location_name : ''}`;

          if (assets.length === 1) {
            const asset = assets[0];
            const msg = `ปัญหาที่แจ้งมา เกิดขึ้นกับเครื่อง **${asset.brand} ${asset.model} (S/N: ${asset.serial_no})** ใช่ไหมครับ?`;
            await conversationService.appendAssistantMessage(conversationToUpdate, msg);
            return messaging.replyTextWithQuickReply(replyToken, msg, [
              { label: '✅ ใช่ เครื่องนี้', text: 'ใช่ เกี่ยวกับเครื่องนี้' },
              { label: '❌ ไม่ใช่เครื่องนี้', text: 'ไม่ใช่เครื่องนี้' }
            ]);
          } else {
            const quickReplies = assets.map((a: any) => ({
              label: `✅ ${getAssetLabel(a)}`.trim(),
              text: `ใช่ เกี่ยวกับเครื่อง S/N: ${a.serial_no}`
            }));
            quickReplies.push({ label: '❌ ไม่ใช่สักเครื่อง', text: 'ไม่ใช่เครื่องนี้' });
            const listStr = assets.map((a: any, i: number) => `${i + 1}. ${getAssetDesc(a)}`).join('\n\n');
            const promptMsg = `พบอุปกรณ์ในระบบดังนี้ครับ ไม่ทราบว่าเป็นเครื่องไหนครับ? 👇\n\n${listStr}`;
            await conversationService.appendAssistantMessage(conversationToUpdate, promptMsg);
            return messaging.replyTextWithQuickReply(replyToken, promptMsg, quickReplies);
          }
        }
      }
    }
  }

  // 🤖 Troubleshooting Advice
  const isClearEnough = issueSummary.length > 25 || issueSummary.includes('ชั้น') || issueSummary.includes('ที่');
  if (!isSkip && !isDirectEscalation && !isClearEnough && conversationToUpdate.status !== 'waiting_troubleshoot_confirm') {
    const advice = await geminiService.getTroubleshootingAdvice(issueSummary);
    conversationToUpdate.status = 'waiting_troubleshoot_confirm';
    conversationToUpdate.issue = issueSummary;
    await conversationToUpdate.save();
    const adviceMsg = `💡 ลองทำตามขั้นตอนเบื้องต้นดูนะครับ:\n\n${advice}\n\nเป็นอย่างไรบ้างครับ?`;
    await conversationService.appendAssistantMessage(conversationToUpdate, adviceMsg);
    return messaging.replyTextWithQuickReply(replyToken, adviceMsg, [
      { label: '✅ พิมพ์แก้ได้แล้ว', text: 'แก้ได้แล้ว' },
      { label: '📞 ติดต่อเจ้าหน้าที่', text: 'ติดต่อเจ้าหน้าที่' }
    ]);
  }

  // ✅ Final Escalation
  conversationToUpdate.status = 'closed';
  conversationToUpdate.escalated = true;
  conversationToUpdate.issue = issueSummary;
  await conversationToUpdate.save();

  if (conversationToUpdate.assetInfo) {
    try {
      const assetData = JSON.parse(conversationToUpdate.assetInfo);
      if (assetData && !Array.isArray(assetData)) {
        hardwareDetails = `\n💻 อุปกรณ์: ${assetData.brand} ${assetData.model} (S/N: ${assetData.serial_no})`;
      }
    } catch (e) { }
  }

  const adminGroupId = process.env.ADMIN_GROUP_ID;
  const ticketId = `IT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  const newTicket = new Ticket({
    ticketId,
    name: user.name,
    employeeId: user.employeeId,
    department: user.department,
    phone: user.phone || 'ไม่ระบุ',
    email: user.email || 'ไม่ระบุ',
    issueSummary: issueSummary + hardwareDetails,
    category,
    subCategory
  });
  await newTicket.save();

  if (adminGroupId) {
    const adminMessage = `🚨 แจ้งเคสใหม่: ${ticketId}\n👤 ${user.name} (${user.employeeId})\n🏢 ${user.department}\n📞 ${user.phone || 'ไม่ระบุ'}\n📝 ${issueSummary}${hardwareDetails}`;
    await messaging.pushText(adminGroupId, adminMessage);
  }

  const finalMsg = `รับทราบครับ! ✅ แจ้งเจ้าหน้าที่เรียบร้อยแล้ว\n🎫 เลข Ticket: ${ticketId}\n\nเจ้าหน้าที่จะติดต่อกลับโดยเร็วที่สุดครับ 🙏`;
  await conversationService.appendAssistantMessage(conversationToUpdate, finalMsg);
  return messaging.replyTextWithQuickReply(replyToken, finalMsg, [{ label: '🚀 เริ่มสนทนาใหม่', text: 'เริ่มสนทนาใหม่' }]);
}

export function checkITRelatedFromSummary(issueSummary: string, conversation: ConversationDoc): boolean {
  const nonItPatterns = ['NON_IT', 'OUT_OF_SCOPE', 'ไม่เกี่ยวกับ IT'];
  for (const pattern of nonItPatterns) {
    if (issueSummary.toUpperCase().includes(pattern.toUpperCase())) return false;
  }
  return true;
}
