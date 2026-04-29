// src/routes/conversations.ts
import express, { Request, Response } from 'express';
import Conversation from '../models/Conversation.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/conversations - ดึงรายการ conversations พร้อม Pagination
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;
    const { 
      status, 
      resolved,
      lineUserId
    } = req.query;

    const filter: any = {};
    if (status) filter.status = status;
    if (resolved !== undefined) filter.resolved = resolved === 'true';
    if (lineUserId) filter.lineUserId = lineUserId;

    // กรองเฉพาะ session ที่มีข้อความ หรือมีการระบุหัวข้อปัญหา (เพื่อความสะอาด)
    filter.$or = [
      { 'messages.0': { $exists: true } },
      { issue: { $nin: ['', 'ไม่ระบุ', 'ไม่สามารถสรุปปัญหาได้'] } }
    ];

    const [conversations, total] = await Promise.all([
      Conversation.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      Conversation.countDocuments(filter)
    ]);

    res.json({
      success: true,
      message: 'OK',
      results: conversations.length,
      data: {
        conversations,
        pagination: {
          total,
          limit,
          page,
          totalPages: Math.ceil(total / limit),
          hasMore: skip + conversations.length < total
        }
      }
    });
  } catch (error) {
    logger.error('Error fetching conversations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch conversations'
    });
  }
});

export default router;
