// src/routes/stats.ts
import express, { Request, Response } from 'express';
import User from '../models/User.js';
import Conversation from '../models/Conversation.js';
import Ticket from '../models/Ticket.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * GET /api/stats - สถิติรวมของระบบ
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalConversations = await Conversation.countDocuments();
    const resolvedConversations = await Conversation.countDocuments({ resolved: true });
    const escalatedConversations = await Conversation.countDocuments({ escalated: true });
    
    // คำนวณ average rating
    const ratingStats = await Conversation.aggregate([
      { $match: { rating: { $ne: null } } },
      {
        $group: {
          _id: null,
          avgRating: { $avg: '$rating' },
          totalRatings: { $sum: 1 }
        }
      }
    ]);

    const avgRating = ratingStats.length > 0 ? ratingStats[0].avgRating : 0;
    const totalRatings = ratingStats.length > 0 ? ratingStats[0].totalRatings : 0;

    // Resolution rate
    const resolutionRate = totalConversations > 0 
      ? ((resolvedConversations / totalConversations) * 100).toFixed(2)
      : 0;

    // Time-based stats
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [conversationsToday, conversationsThisWeek] = await Promise.all([
      Conversation.countDocuments({ createdAt: { $gte: today } }),
      Conversation.countDocuments({ createdAt: { $gte: weekAgo } })
    ]);

    // Average Resolution Time (for resolved tickets)
    const resolutionStats = await Ticket.aggregate([
      { $match: { resolvedAt: { $ne: null }, reportedAt: { $ne: null } } },
      {
        $project: {
          duration: { $subtract: ['$resolvedAt', '$reportedAt'] }
        }
      },
      {
        $group: {
          _id: null,
          avgDuration: { $avg: '$duration' }
        }
      }
    ]);

    const avgResolutionTimeMs = resolutionStats.length > 0 ? resolutionStats[0].avgDuration : 0;
    const avgResolutionTimeHours = (avgResolutionTimeMs / (1000 * 60 * 60)).toFixed(1);

    // Department Stats
    const departmentStats = await Ticket.aggregate([
      {
        $group: {
          _id: '$department',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    res.json({
      success: true,
      message: 'OK',
      results: 1,
      data: {
        totalUsers,
        totalConversations,
        resolvedConversations,
        unresolvedConversations: totalConversations - resolvedConversations,
        escalatedConversations,
        resolutionRate: resolutionRate.toString(),
        averageRating: avgRating.toFixed(2),
        totalRatings,
        conversationsToday,
        conversationsThisWeek,
        averageResolutionTime: avgResolutionTimeHours,
        departmentStats: departmentStats.map(d => ({ department: d._id || 'ไม่ระบุ', count: d.count }))
      }
    });
  } catch (error) {
    logger.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics'
    });
  }
});

/**
 * GET /api/stats/trends - ดึงแนวโน้มเคสรายวัน (7 วันย้อนหลัง)
 */
router.get('/trends', async (_req: Request, res: Response) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const trends = await Ticket.aggregate([
      { $match: { reportedAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$reportedAt" } },
          count: { $sum: 1 },
          resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Fill missing days
    const result = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const found = trends.find(t => t._id === dateStr);
      result.push({
        date: dateStr,
        count: found ? found.count : 0,
        resolved: found ? found.resolved : 0
      });
    }

    res.json({ success: true, message: 'OK', results: result.length, data: result });
  } catch (error) {
    logger.error('Error fetching trends:', error);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

/**
 * GET /api/stats/activity - กิจกรรมล่าสุด
 */
router.get('/activity', async (_req: Request, res: Response) => {
  try {
    const tickets = await Ticket.find()
      .sort({ reportedAt: -1 })
      .limit(10)
      .lean();

    const activities = [];
    for (const t of tickets) {
      activities.push({
        id: t.ticketId,
        user: t.name,
        issue: t.issueSummary.split('\n')[0],
        status: t.status,
        time: t.reportedAt,
        type: 'new_ticket'
      });

      // Add status changes from history
      if (t.statusHistory) {
        for (const h of t.statusHistory) {
          activities.push({
            id: t.ticketId,
            user: h.changedBy || 'System',
            status: h.status,
            time: h.changedAt,
            type: 'status_change',
            targetUser: t.name
          });
        }
      }
    }

    activities.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    const finalData = activities.slice(0, 15);
    res.json({ success: true, message: 'OK', results: finalData.length, data: finalData });
  } catch (error) {
    logger.error('Error fetching activity:', error);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

/**
 * GET /api/stats/issues - สรุปปัญหาที่ผู้ใช้แจ้งบ่อย
 */
router.get('/issues', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    
    // Aggregate issues from conversations
    const issueStats = await Conversation.aggregate([
      { $match: { issue: { $nin: ['', 'ไม่ระบุ', 'ไม่สามารถสรุปปัญหาได้'] } } },
      {
        $group: {
          _id: '$issue',
          count: { $sum: 1 },
          resolvedCount: { $sum: { $cond: [{ $eq: ['$resolved', true] }, 1, 0] } },
          averageRating: { $avg: '$rating' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          issue: '$_id',
          count: 1,
          resolvedCount: 1,
          averageRating: 1,
          resolutionRate: {
            $cond: [
              { $gt: ['$count', 0] },
              { $multiply: [{ $divide: ['$resolvedCount', '$count'] }, 100] },
              0
            ]
          }
        }
      }
    ]);

    // Format resolutionRate to string with 1 decimal place as expected by frontend
    const formattedStats = issueStats.map(item => ({
      ...item,
      resolutionRate: item.resolutionRate.toFixed(1)
    }));

    res.json({ success: true, message: 'OK', results: formattedStats.length, data: formattedStats });
  } catch (error) {
    logger.error('Error fetching issue stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch issue stats' });
  }
});

/**
 * GET /api/stats/ratings - ดึงคะแนนความพึงพอใจทั้งหมด
 */
router.get('/ratings', async (_req: Request, res: Response) => {
  try {
    const ratingStats = await Conversation.aggregate([
      { $match: { rating: { $ne: null } } },
      {
        $group: {
          _id: '$rating',
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          rating: '$_id',
          count: 1
        }
      }
    ]);

    // Ensure all ratings 1-5 are present
    const fullStats = [1, 2, 3, 4, 5].map(r => {
      const found = ratingStats.find(s => s.rating === r);
      return { rating: r, count: found ? found.count : 0 };
    });

    res.json({ success: true, message: 'OK', results: fullStats.length, data: fullStats });
  } catch (error) {
    logger.error('Error fetching ratings:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch ratings' });
  }
});

export default router;
