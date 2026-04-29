// src/routes/users.ts
import express, { Request, Response } from 'express';
import User from '../models/User.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/users - ดึงรายการผู้ใช้ทั้งหมดพร้อม Pagination
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string;
    const filter: any = {};
    if (search) {
      // Escape special regex characters to avoid issues with search terms
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { employeeId: { $regex: escapedSearch, $options: 'i' } },
        { department: { $regex: escapedSearch, $options: 'i' } },
        { lineUserId: { $regex: escapedSearch, $options: 'i' } }
      ];
      
      // If the search looks like a full LINE ID (usually starts with U and is long), 
      // add an exact match to the $or just in case regex is being weird
      if (search.startsWith('U') && search.length > 10) {
        filter.$or.push({ lineUserId: search });
      }
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ registeredAt: -1 })
        .lean(),
      User.countDocuments(filter)
    ]);

    res.json({
      success: true,
      message: 'OK',
      results: users.length,
      data: {
        users,
        pagination: {
          total,
          limit: users.length,
          page: 1,
          totalPages: 1,
          hasMore: false
        }
      }
    });
  } catch (error) {
    logger.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

export default router;
