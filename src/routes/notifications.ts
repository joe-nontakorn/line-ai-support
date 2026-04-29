// src/routes/notifications.ts
import express, { Request, Response } from 'express';
import Notification from '../models/Notification.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/notifications - ดึงประวัติแจ้งเตือนย้อนหลัง
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const notifications = await Notification.find()
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    
    res.json({ success: true, message: 'OK', results: notifications.length, data: notifications });
  } catch (error) {
    logger.error('Error fetching notifications:', error);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

/**
 * PUT /api/notifications/:id/read - ทำเครื่องหมายว่าอ่านแล้ว
 */
router.put('/:id/read', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await Notification.findByIdAndUpdate(id, { isRead: true });
    res.json({ success: true, message: 'OK', results: 0, data: null });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

/**
 * PUT /api/notifications/read-all - ทำเครื่องหมายว่าอ่านแล้วทั้งหมด
 */
router.put('/read-all', async (_req: Request, res: Response) => {
  try {
    await Notification.updateMany({ isRead: false }, { isRead: true });
    res.json({ success: true, message: 'OK', results: 0, data: null });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

/**
 * DELETE /api/notifications - ล้างประวัติแจ้งเตือน
 */
router.delete('/', async (_req: Request, res: Response) => {
  try {
    await Notification.deleteMany({});
    res.json({ success: true, message: 'OK', results: 0, data: null });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

export default router;
