// src/services/conversationDailyReset.ts
import Conversation from '../models/Conversation.js';
import { logger } from '../utils/logger.js';

const ACTIVE_STATUSES = [
  'active',
  'waiting_escalation_issue',
  'waiting_rating',
  'waiting_hardware_confirm',
  'waiting_troubleshoot_confirm',
];

/**
 * ปิดการสนทนาที่ยังค้างอยู่ทั้งหมด
 * - สนทนาที่ไม่มีข้อความ → ลบทิ้ง
 * - สนทนาที่มีข้อความ → เปลี่ยนสถานะเป็น closed
 */
async function closeAllConversations(): Promise<{ deleted: number; closed: number }> {
  const now = new Date();

  // ลบสนทนาเปล่า (ไม่มีข้อความ)
  const deleteResult = await Conversation.deleteMany({
    status: { $in: ACTIVE_STATUSES },
    $or: [{ messages: { $size: 0 } }, { messages: { $exists: false } }],
  });

  // ปิดสนทนาที่มีข้อความ
  const updateResult = await Conversation.updateMany(
    { status: { $in: ACTIVE_STATUSES } },
    { $set: { status: 'closed', closedAt: now } },
  );

  return {
    deleted: deleteResult.deletedCount || 0,
    closed: updateResult.modifiedCount || 0,
  };
}

/**
 * คำนวณจำนวน ms จนถึงเวลา 23:59 ของวันนี้ (เวลากรุงเทพ)
 * ถ้าเลย 23:59 ไปแล้ว จะคำนวณเป็น 23:59 ของวันพรุ่งนี้แทน
 */
function msUntilBangkok2359(): number {
  const now = new Date();

  // สร้างเวลา 23:59 ของวันนี้ในเขตเวลากรุงเทพ (UTC+7)
  const bangkokOffset = 7 * 60; // minutes
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const bangkokMinutes = utcMinutes + bangkokOffset;

  // เวลา 23:59 กรุงเทพ = 16:59 UTC
  const target2359UTC_hours = 23 - 7; // 16
  const target2359UTC_minutes = 59;

  const target = new Date(now);
  target.setUTCHours(target2359UTC_hours, target2359UTC_minutes, 0, 0);

  // ถ้าเลยเวลาไปแล้ว → เลื่อนไปวันพรุ่งนี้
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  return target.getTime() - now.getTime();
}

/**
 * ตั้ง schedule ให้ปิดสนทนาทุกวันเวลา 23:59 กรุงเทพ
 * แล้ว re-schedule ตัวเองใหม่สำหรับวันถัดไป
 */
export function startConversationDailyReset(): void {
  const ms = msUntilBangkok2359();
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);

  logger.info(`🔄 Conversation Daily Reset scheduled in ${hours}h ${minutes}m (23:59 Bangkok time)`);

  setTimeout(async () => {
    try {
      logger.info('🔄 Running Conversation Daily Reset...');
      const result = await closeAllConversations();
      logger.info(
        `✅ Conversation Daily Reset complete: ${result.closed} closed, ${result.deleted} empty deleted`,
      );
    } catch (error) {
      logger.error('Conversation Daily Reset error', error);
    }

    // Re-schedule สำหรับวันถัดไป (ประมาณ 24 ชม.)
    startConversationDailyReset();
  }, ms);
}
