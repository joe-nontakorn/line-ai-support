// src/services/ticketAutoClose.ts
import Ticket from '../models/Ticket.js';
import { logger } from '../utils/logger.js';

/**
 * ฟังก์ชันสำหรับตรวจสอบและปิด Ticket ที่รอ User ยืนยันมาเกิน 24 ชั่วโมงแบบอัตโนมัติ
 */
export async function startTicketAutoCloseWorker() {
  // รันทุกๆ 1 ชั่วโมง
  const INTERVAL = 60 * 60 * 1000;

  logger.info('🕒 Ticket Auto-Close Worker started (Running every 1 hour)');

  setInterval(async () => {
    try {
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // ค้นหา Ticket ที่มีสถานะ waiting_user_confirm และไม่มีการอัปเดตเกิน 24 ชม.
      // โดยตรวจสอบจากประวัติสถานะล่าสุด (statusHistory)
      const ticketsToClose = await Ticket.find({
        status: 'waiting_user_confirm',
        'statusHistory.changedAt': { $lt: twentyFourHoursAgo }
      });

      if (ticketsToClose.length === 0) return;

      logger.info(`🤖 Found ${ticketsToClose.length} tickets to auto-close.`);

      for (const ticket of ticketsToClose) {
        // ตรวจสอบเช็คอีกครั้งให้แน่ใจว่าประวัติล่าสุดคือ waiting_user_confirm และเก่าเกิน 24 ชม. จริง
        const lastHistory = ticket.statusHistory[ticket.statusHistory.length - 1];
        
        if (lastHistory && lastHistory.status === 'waiting_user_confirm' && lastHistory.changedAt < twentyFourHoursAgo) {
          ticket.status = 'resolved';
          ticket.resolvedAt = new Date();
          ticket.statusHistory.push({
            status: 'resolved',
            changedAt: new Date(),
            changedBy: 'System (Auto-Close)',
            comment: 'Auto-closed after 24 hours of inactivity in waiting_user_confirm state.'
          });

          await ticket.save();
          logger.info(`✅ Ticket ${ticket.ticketId} auto-closed successfully.`);
        }
      }
    } catch (error) {
      logger.error('Error in Ticket Auto-Close Worker:', error);
    }
  }, INTERVAL);
}
