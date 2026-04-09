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

  const replyMsg = 'ขอบคุณสำหรับคะแนนประเมินครับ! หากมีปัญหาอื่นๆ สอบถามได้เสมอครับ 😊';
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
  let conversationToUpdate = conversation;

  if (!conversationToUpdate) {
    conversationToUpdate = await conversationService.createNewConversation(userId, 'active');
  }

  if (!conversationToUpdate) return;

  if (text) {
    await conversationService.appendUserMessage(conversationToUpdate, text);
  }

  // ใช้ AI สรุปปัญหาจากประวัติทั้งหมด (เพื่อให้ครอบคลุมสิ่งที่เพิ่งพิมพ์มาด้วย)
  // ⚡ สำหรับ direct escalation ที่มี user message แค่ 1 ข้อความ ใช้ข้อความ user ตรงๆ โดยไม่ต้องเรียก AI
  const isDirectEscalation = conversationToUpdate.status === 'waiting_escalation_issue';
  const userMessages = conversationToUpdate.messages.filter(m => m.role === 'user');

  if (isDirectEscalation && userMessages.length === 1 && text) {
    // Direct escalation: ใช้ข้อความ user ตรงๆ เพื่อความเร็ว
    issueSummary = text.trim();
  } else if (conversationToUpdate.messages.length > 0) {
    issueSummary = await conversationService.analyzeIssueSafe(conversationToUpdate.messages);
  } else if (conversationToUpdate.issue && conversationToUpdate.issue !== 'ไม่ระบุ') {
    issueSummary = conversationToUpdate.issue;
  }

  // 🛡️ Fallback chain: ถ้า AI สรุปไม่ได้ (timeout / error) ให้ดึงจากแหล่งอื่น
  if (issueSummary === 'ไม่ระบุ' || issueSummary === 'ไม่สามารถสรุปปัญหาได้') {
    // Fallback 1: ใช้ issue ที่เคยบันทึกไว้ใน conversation (จากขั้นตอน troubleshooting ก่อนหน้า)
    if (conversationToUpdate.issue && conversationToUpdate.issue !== 'ไม่ระบุ' && conversationToUpdate.issue !== 'ไม่สามารถสรุปปัญหาได้') {
      issueSummary = conversationToUpdate.issue;
    }
    // Fallback 2: ใช้ข้อความล่าสุดที่ user พิมพ์มา
    else if (text) {
      issueSummary = text.trim();
    }
    // Fallback 3: ดึงจากข้อความ user ในประวัติสนทนา (เอาข้อความแรกที่ user แจ้งปัญหา)
    else if (userMessages.length > 0) {
      issueSummary = userMessages
        .map(m => m.content)
        .filter(c => c.length > 3 && !c.startsWith('ใช่') && !c.startsWith('ไม่'))
        .slice(0, 2)
        .join(' | ') || userMessages[0].content;
    }
  }

  // ❌ ไม่ส่ง admin ถ้าไม่มีการระบุปัญหา
  if (issueSummary === 'ไม่ระบุ' || issueSummary.trim() === '' || issueSummary === 'ไม่สามารถสรุปปัญหาได้') {
    const errorMsg = '⚠️ กรุณาระบุปัญหาหรืออาการที่พบให้ชัดเจนก่อนนะครับ เจ้าหน้าที่จะได้เข้าใจและช่วยได้อย่างถูกต้อง\n\nเช่น "เชื่อมต่อ VPN ไม่ได้", "เปิด Outlook แล้ว Error", "Printer ไม่ทำงาน"';
    await conversationService.appendAssistantMessage(conversationToUpdate, errorMsg);
    return messaging.replyText(
      replyToken,
      errorMsg
    );
  }

  // ❌ ตรวจสอบกับ AI ว่าเป็นปัญหา IT จริงหรือไม่
  const isItRelated = await checkITRelatedWithAI(issueSummary, conversationToUpdate);
  if (!isItRelated) {
    // ปิดการสนทนาแล้วแจ้งผู้ใช้
    conversationToUpdate.status = 'closed';
    // ไม่บันทึก issue เพื่อไม่ให้ขึ้นในรายงานสรุปปัญหา IT
    await conversationToUpdate.save();

    const rejectMsg = 'ขออภัยครับ ระบบนี้รองรับเฉพาะปัญหาด้าน IT Support เท่านั้น\n\nหากมีปัญหาด้าน IT สอบถามได้เลยครับ 😊';
    await conversationService.appendAssistantMessage(conversationToUpdate, rejectMsg);

    return messaging.replyTextWithQuickReply(
      replyToken,
      rejectMsg,
      [{ label: '🚀 เริ่มสนทนาใหม่', text: 'เริ่มสนทนาใหม่' }],
    );
  }
  const isSkip = text?.trim() === 'ข้าม';
  if (!isSkip && !isDirectEscalation && conversationToUpdate.status !== 'waiting_hardware_confirm' && conversationToUpdate.status !== 'waiting_troubleshoot_confirm') {
    // 🔍 ป้องกัน Loop โดยเช็กจำนวนข้อความในสถานะนี้ (ถ้าถามไปแล้ว 2 ครั้งยังไม่เคลียร์ ก็ให้ผ่านไป)
    const userMessagesInState = conversationToUpdate.messages.filter(m => m.role === 'user').length;

    // ถ้า issue สั้นเกินไปหรือกว้างเกินไป (เช่น "ช่วยด้วย") ถึงจะถาม clarification
    // แต่ถ้ามีข้อมูลพอสมควรแล้ว ให้ผ่านไปขั้นตอนถัดไปเลย เพื่อความรวดเร็วตามความต้องการผู้ใช้
    if (userMessagesInState <= 1 && issueSummary.length < 15) {
      const clarification = await geminiService.clarifyIssue(issueSummary);
      if (clarification && clarification !== 'CLEAR') {
        await conversationToUpdate.save();
        const clarMsg = `${clarification}\n\n(หรือพิมพ์ "ข้าม" เพื่อแจ้งเจ้าหน้าที่ทันที)`;
        await conversationService.appendAssistantMessage(conversationToUpdate, clarMsg);
        return messaging.replyText(
          replyToken,
          clarMsg
        );
      }
    }
  }

  // ถ้าพิมพ์ว่า "ข้าม" ให้ข้ามการกรองรายละเอียด ดึง issue เดิมจากประวัติ
  if (isSkip) {
    issueSummary = await conversationService.analyzeIssueSafe(
      conversationToUpdate.messages
        .filter(m => m.content !== 'ข้าม')
        .map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp }))
    );
  }

  // 🔎 แจ้งเรื่องอุปกรณ์ฮาร์ดแวร์ (ยกเว้นรอยืนยันฮาร์ดแวร์เดิม หรือกำลังรอคอนเฟิร์มวิธีแก้ปัญหา หรือผู้ใช้กดข้าม)
  if (!isSkip && !isDirectEscalation && conversationToUpdate.status !== 'waiting_hardware_confirm' && conversationToUpdate.status !== 'waiting_troubleshoot_confirm') {
    const printerKeywords = ['ปริ้น', 'printer', 'เครื่องพิมพ์', 'สแกน', 'scanner', 'หมึก', 'หมึกพิมพ์'];
    const computerKeywords = ['เครื่องเสีย', 'เปิดไม่ติด', 'จอดำ', 'จอฟ้า', 'คอม', 'โน๊ตบุ๊ค', 'laptop', 'desktop', 'พีซี', 'pc'];
    const otherHwKeywords = ['อุปกรณ์', 'จอ', 'เมาส์', 'คีย์บอร์ด', 'ฮาร์ดแวร์', 'พัง', 'usb', 'monitor', 'keyboard', 'mouse'];

    const summaryLower = issueSummary.toLowerCase();
    const isPrinter = printerKeywords.some(kw => summaryLower.includes(kw));
    const isComputer = computerKeywords.some(kw => summaryLower.includes(kw));
    const isOtherHw = otherHwKeywords.some(kw => summaryLower.includes(kw));

    if (isPrinter || isComputer || isOtherHw) {
      try {
        let apiUrl = `${apiAsset}/assets/search?`;
        let useFilter = false;

        if (isPrinter) {
          // Shared devices (Printer/Scanner)
          apiUrl += `type_name=Printer`;
          useFilter = true; // Use local filter as fallback/backup
        } else {
          // Personal devices (Search by employee name)
          apiUrl += `employee_name=${encodeURIComponent(user!.name)}`;
          if (isComputer) useFilter = true;
        }

        const res = await fetch(apiUrl);
        if (res.ok) {
          const result = await res.json() as any;
          if (result.success && result.data && result.data.length > 0) {
            let assets = result.data.filter((a: any) => {
              const status = (a.status || '').toLowerCase();
              return status !== 'retired' && status !== 'disposed';
            });

            // Filter for specific types if context is known
            if (useFilter) {
              if (isPrinter) {
                assets = assets.filter((a: any) => a.type_name === 'Printer');

                // 🧠 Relevance Scoring: วิเคราะห์ Brand, Model, Description, Location
                // เพื่อหาเครื่องที่ตรงกับปัญหาของ user มากที่สุด
                const issueWords = summaryLower
                  .replace(/[^\u0E00-\u0E7Fa-z0-9\s]/gi, ' ') // ลบอักขระพิเศษ
                  .split(/\s+/)
                  .filter(w => w.length >= 2)
                  // กรองคำทั่วไปที่ไม่ควรใช้ match (stop words)
                  .filter(w => ![
                    'ปริ้น', 'printer', 'เครื่อง', 'เครื่องพิมพ์', 'พิมพ์', 'ไม่', 'ได้', 'ไม่ได้',
                    'ออก', 'ไม่ออก', 'มี', 'ปัญหา', 'แก้', 'ไข', 'แก้ไข', 'ช่วย', 'ครับ', 'ค่ะ',
                    'ที่', 'ของ', 'และ', 'หรือ', 'กับ', 'ใน', 'จะ', 'ให้', 'เป็น', 'อยู่',
                    'ไฟ', 'สี', 'แดง', 'เขียว', 'เหลือง', 'ส้ม', 'กะพริบ', 'ติด', 'ดับ',
                    'กระดาษ', 'หมึก', 'ติด', 'จาม', 'error', 'ทำงาน', 'ใช้', 'งาน',
                    'รุ่น', 'model', 'brand', 'ยี่ห้อ', 'เครื่องนี้',
                  ].includes(w));

                if (issueWords.length > 0) {
                  // คำนวณคะแนน relevance ของแต่ละ asset
                  const scoredAssets = assets.map((a: any) => {
                    const brand = (a.brand || '').toLowerCase();
                    const model = (a.model || '').toLowerCase().replace(/\s+/g, ''); // "P 502" → "p502"
                    const desc = (a.description || '').toLowerCase();
                    const loc = (a.location_name || '').toLowerCase();
                    const searchable = `${brand} ${model} ${a.model || ''} ${desc} ${loc}`.toLowerCase();

                    let score = 0;
                    for (const word of issueWords) {
                      const wordNoSpace = word.replace(/\s+/g, '');
                      // Brand match (น้ำหนัก 3)
                      if (brand.includes(word)) score += 3;
                      // Model match — เทียบทั้งแบบมี space และไม่มี (น้ำหนัก 5)
                      if (model.includes(wordNoSpace) || (a.model || '').toLowerCase().includes(word)) score += 5;
                      // Description match — เช่น "บัญชี", "IDC", "ACC" (น้ำหนัก 4)
                      if (desc.includes(word)) score += 4;
                      // Location match — เช่น "7f", "office" (น้ำหนัก 2)
                      if (loc.includes(word)) score += 2;
                    }

                    return { asset: a, score };
                  });

                  // เรียงตามคะแนนจากมากไปน้อย
                  scoredAssets.sort((a, b) => b.score - a.score);

                  const maxScore = scoredAssets[0]?.score || 0;
                  if (maxScore > 0) {
                    // เอาเฉพาะ asset ที่มีคะแนนสูงสุด (หรือใกล้เคียง ±30%)
                    const threshold = Math.max(maxScore * 0.7, 1);
                    assets = scoredAssets
                      .filter(s => s.score >= threshold)
                      .map(s => s.asset);
                  }
                }

                // กรองเพิ่มเติมด้วยชั้น (ถ้า user ระบุ)
                const floorMatch = summaryLower.match(/ชั้น\s*(\d+)/i) || summaryLower.match(/(\d+)\s*f/i);
                if (floorMatch) {
                  const floorNum = floorMatch[1] || floorMatch[2];
                  const floorFiltered = assets.filter((a: any) => {
                    const loc = (a.location_name || '').toLowerCase();
                    const desc = (a.description || '').toLowerCase();
                    return loc.includes(`${floorNum}f`) || loc.includes(`ชั้น ${floorNum}`) || loc.includes(`ชั้น${floorNum}`) ||
                      desc.includes(`${floorNum}f`) || desc.includes(`ชั้น ${floorNum}`) || desc.includes(`ชั้น${floorNum}`);
                  });
                  if (floorFiltered.length > 0) assets = floorFiltered;
                }

                // กรองขาวดำ/สี (ต้องระบุชัดเจน)
                const isBW = summaryLower.includes('ขาวดำ') || summaryLower.includes('ขาว-ดำ');
                const isColor = /(ปริ้น|เครื่อง|พิมพ์|printer)\s*สี/i.test(summaryLower) && !isBW;

                if (isBW) {
                  const bwFiltered = assets.filter((a: any) => {
                    const desc = (a.description || '').toLowerCase();
                    return desc.includes('ขาวดำ') || desc.includes('ขาว-ดำ') || desc.includes('ดำ') || desc.includes('bw');
                  });
                  if (bwFiltered.length > 0) assets = bwFiltered;
                } else if (isColor) {
                  const colorFiltered = assets.filter((a: any) => {
                    const desc = (a.description || '').toLowerCase();
                    return desc.includes('สี') || desc.includes('color');
                  });
                  if (colorFiltered.length > 0) assets = colorFiltered;
                }

              } else if (isComputer) {
                assets = assets.filter((a: any) =>
                  a.type_name === 'Laptop' || a.type_name === 'Desktop'
                );
              }
            }

            if (assets.length > 0) {
              assets = assets.slice(0, 12); // Limit to 12 for Quick Replies (max 13 buttons limit)
              conversationToUpdate.status = 'waiting_hardware_confirm';
              conversationToUpdate.assetInfo = JSON.stringify(assets);
              await conversationToUpdate.save();

              const getAssetLabel = (a: any) => {
                const brandModel = `${a.brand || ''} ${a.model || ''}`.trim();
                const loc = a.location_name ? ` (${a.location_name})` : '';
                return `${brandModel}${loc}`.substring(0, 15); // Leave room for emoji
              };

              const getAssetDesc = (a: any) => {
                let desc = `${a.brand} ${a.model}\n   S/N: ${a.serial_no}`;
                if (a.location_name) desc += `\n   📍 ตำแหน่ง: ${a.location_name}`;
                if (a.description) desc += `\n   📝 รายละเอียด: ${a.description}`;
                return desc;
              };

              if (assets.length === 1) {
                const asset = assets[0];
                const assetStr = `${asset.brand} ${asset.model} (S/N: ${asset.serial_no})`;
                let msg = `ระบบตรวจพบว่าปัญหาอาจเกี่ยวข้องกับ ${assetStr}\nใช่เครื่องนี้หรือไม่ครับ?`;
                if (asset.location_name) msg = `ระบบตรวจพบอุปกรณ์ที่ ${asset.location_name}: ${assetStr}\nเป็นเครื่องที่มีปัญหาใช่หรือไม่ครับ?`;

                await conversationService.appendAssistantMessage(conversationToUpdate, msg);

                return messaging.replyTextWithQuickReply(
                  replyToken,
                  msg,
                  [
                    { label: '✅ ใช่', text: 'ใช่ เกี่ยวกับเครื่องนี้' },
                    { label: '❌ ไม่ใช่', text: 'ไม่ใช่เครื่องนี้' }
                  ]
                );
              } else {
                // Multiple assets
                const quickReplies = assets.map((a: any) => ({
                  label: `✅ ${getAssetLabel(a)}`.substring(0, 20).trim(),
                  text: `ใช่ เกี่ยวกับเครื่อง S/N: ${a.serial_no}`
                }));
                quickReplies.push({ label: '❌ ไม่ใช่สักเครื่อง', text: 'ไม่ใช่เครื่องนี้' });

                const listStr = assets.map((a: any, i: number) => `${i + 1}. ${getAssetDesc(a)}`).join('\n\n');
                const promptMsg = isPrinter
                  ? `พบเครื่องพิมพ์/อุปกรณ์ส่วนกลางในระบบดังนี้ครับ ไม่ทราบว่าเป็นเครื่องไหนและอยู่ชั้นไหนครับ?\n\n${listStr}`
                  : `พบอุปกรณ์ของคุณในระบบหลายรายการ ปัญหาเกี่ยวข้องกับรายการไหนครับ?\n\n${listStr}`;

                await conversationService.appendAssistantMessage(conversationToUpdate, promptMsg);

                return messaging.replyTextWithQuickReply(
                  replyToken,
                  promptMsg,
                  quickReplies
                );
              }
            }
          }
        }
      } catch (err) {
        logger.error('Error fetching asset info:', err);
      }
    }
  }

  // 🤖 ขั้นตอนการแนะนำวิธีแก้ปัญหาเบื้องต้น (Self-Service)
  // จะข้ามขั้นตอนนี้ถ้า:
  // 1. ผู้ใช้พิมพ์ "ข้าม" มา
  // 2. เคยผ่านขั้นตอนนี้มาแล้ว
  // 3. ปัญหามีความชัดเจนมากพอ (เช่น ระบุชั้น/สถานที่ หรือ สรุปปัญหาได้ยาวพอ)
  const isClearEnough = issueSummary.length > 25 || issueSummary.includes('ชั้น') || issueSummary.includes('ที่');

  if (!isSkip && !isDirectEscalation && !isClearEnough && conversationToUpdate!.status !== 'waiting_troubleshoot_confirm') {
    const advice = await geminiService.getTroubleshootingAdvice(issueSummary);

    conversationToUpdate.status = 'waiting_troubleshoot_confirm';
    conversationToUpdate.issue = issueSummary;
    await conversationToUpdate.save();

    const adviceMsg = `💡 ลองทำตามขั้นตอนเบื้องต้นด้านล่างนี้ดูนะครับ อาจช่วยให้ปัญหาคุณดีขึ้นทันที:\n\n${advice}\n\nลองทำตามดูแล้วเป็นอย่างไรบ้างครับ?`;
    await conversationService.appendAssistantMessage(conversationToUpdate, adviceMsg);

    return messaging.replyTextWithQuickReply(
      replyToken,
      adviceMsg,
      [
        { label: '✅ พิมพ์แก้ได้แล้ว', text: 'แก้ได้แล้ว' },
        { label: '❌ ยังแก้ไม่ได้', text: 'ยังแก้ไม่ได้' }
      ]
    );
  }

  // ✅ ปิดการสนทนาและบันทึกข้อมูล (เมื่อยืนยันว่ายังแก้ไม่ได้)
  conversationToUpdate.status = 'closed';
  conversationToUpdate.escalated = true;
  conversationToUpdate.issue = issueSummary;
  await conversationToUpdate.save();

  let hardwareDetails = '';
  if (conversationToUpdate.assetInfo) {
    try {
      const assetData = JSON.parse(conversationToUpdate.assetInfo);
      if (assetData && !Array.isArray(assetData)) {
        const loc = assetData.location_name ? ` [${assetData.location_name}]` : '';
        let warrantyInfo = '';
        if (assetData.warranty_expiry) {
          const expiryDate = new Date(assetData.warranty_expiry);
          const now = new Date();
          if (expiryDate < now) {
            warrantyInfo = '\n   🛡️ สถานะประกัน: หมดประกันแล้ว';
          } else {
            const diffTime = expiryDate.getTime() - now.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            let timeStr = '';
            if (diffDays >= 365) {
              const years = Math.floor(diffDays / 365);
              const months = Math.floor((diffDays % 365) / 30);
              timeStr = `${years} ปี ${months > 0 ? months + ' เดือน' : ''}`.trim();
            } else if (diffDays >= 30) {
              const months = Math.floor(diffDays / 30);
              const days = diffDays % 30;
              timeStr = `${months} เดือน ${days > 0 ? days + ' วัน' : ''}`.trim();
            } else {
              timeStr = `${diffDays} วัน`;
            }
            warrantyInfo = `\n   🛡️ สถานะประกัน: เหลืออีก ${timeStr}`;
          }
        }
        hardwareDetails = `\n💻 อุปกรณ์: ${assetData.brand} ${assetData.model}${loc} (S/N: ${assetData.serial_no})${warrantyInfo}`;
      }
    } catch (e) { }
  }

  // ✅ แจ้ง Admin Group (เฉพาะปัญหา IT ที่มีการระบุชัดเจน)
  const adminGroupId = process.env.ADMIN_GROUP_ID;

  // Gen Ticket ID (e.g. IT-A1B2C3) แบบสุ่ม (ไม่เป็นแพทเทิร์น)
  const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
  const ticketId = `IT-${randomStr}`;

  // บันทึกข้อมูลลง MongoDB ตามรูปแบบ
  const newTicket = new Ticket({
    ticketId: ticketId,
    name: user!.name,
    employeeId: user!.employeeId,
    department: user!.department,
    email: user!.email || 'ไม่ระบุ',
    phone: user!.phone || 'ไม่ระบุ',
    issueSummary: issueSummary + hardwareDetails
  });
  await newTicket.save();

  if (adminGroupId) {
    const adminMessage =
      `🚨 มีการแจ้งเคสใหม่จากพนักงาน\n` +
      `🎫 เลขที่ Ticket: ${ticketId}\n\n` +
      `👤 ชื่อ: ${user!.name}\n` +
      `🆔 รหัสพนักงาน: ${user!.employeeId}\n` +
      `📁 แผนก: ${user!.department}\n` +
      `📧 Email: ${user!.email || 'ไม่ระบุ'}\n` +
      `📞 เบอร์ติดต่อ: ${user!.phone || 'ไม่ระบุ'}\n\n` +
      `📝 สรุปปัญหา: ${issueSummary}${hardwareDetails}`;

    await messaging.pushText(adminGroupId, adminMessage);
  }

  // ✅ ตอบกลับผู้ใช้พร้อมปุ่มเริ่มสนทนาใหม่
  const finalMsg = `รับทราบครับ! ✅ ระบบได้แจ้งเจ้าหน้าที่ IT Support ให้เรียบร้อยแล้ว\n🎫 เลขที่ Ticket ของคุณคือ: ${ticketId}\n\nเจ้าหน้าที่จะติดต่อกลับหาคุณโดยเร็วที่สุดครับ 🙏\n\n─────────────────\nหากต้องการแจ้งปัญหาเพิ่มเติม กดปุ่มเพื่อเริ่มการสนทนาใหม่ได้เลยครับ 👇`;
  await conversationService.appendAssistantMessage(conversationToUpdate, finalMsg);

  return messaging.replyTextWithQuickReply(
    replyToken,
    finalMsg,
    [{ label: '🚀 เริ่มสนทนาใหม่', text: 'เริ่มสนทนาใหม่' }],
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
      logger.info(`[IT-Filter] Rejected non-IT issue: "${issueSummary}" → AI: "${aiResult}"`);
      return false;
    }

    return true;
  } catch (error) {
    // ถ้า AI ล้มเหลว ให้ผ่านไปก่อน (fail-open) เพื่อไม่ให้พลาดเคสจริง
    logger.error('[IT-Filter] AI check failed, allowing escalation:', error);
    return true;
  }
}
