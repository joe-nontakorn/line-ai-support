import express, { Request, Response } from 'express';
import User from '../models/User.js';
import Conversation from '../models/Conversation.js';
import Ticket from '../models/Ticket.js';

const router = express.Router();

/**
 * GET /api/stats - สถิติรวมของระบบ
 */
router.get('/stats', async (req: Request, res: Response) => {
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

    res.json({
      success: true,
      data: {
        totalUsers,
        totalConversations,
        resolvedConversations,
        escalatedConversations,
        resolutionRate: parseFloat(resolutionRate as string),
        averageRating: parseFloat(avgRating.toFixed(2)),
        totalRatings
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics'
    });
  }
});

/**
 * GET /api/conversations - ดึงรายการ conversations
 * Query params:
 *   - limit: จำนวนที่ต้องการดึง (default: 50)
 *   - skip: ข้ามกี่รายการ (pagination)
 *   - status: filter ตาม status
 *   - resolved: filter resolved true/false
 */
router.get('/conversations', async (req: Request, res: Response) => {
  try {
    const { 
      limit = '50', 
      skip = '0', 
      status, 
      resolved,
      lineUserId
    } = req.query;

    const filter: any = {};
    if (status) filter.status = status;
    if (resolved !== undefined) filter.resolved = resolved === 'true';
    if (lineUserId) filter.lineUserId = lineUserId;

    const conversations = await Conversation.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string))
      .skip(parseInt(skip as string))
      .lean();

    // ดึงข้อมูล user มาด้วย
    const conversationsWithUsers = await Promise.all(
      conversations.map(async (conv) => {
        const user = await User.findOne({ lineUserId: conv.lineUserId }).lean();
        return {
          ...conv,
          user: user ? {
            name: user.name,
            employeeId: user.employeeId,
            department: user.department
          } : null
        };
      })
    );

    const total = await Conversation.countDocuments(filter);

    res.json({
      success: true,
      data: {
        conversations: conversationsWithUsers,
        pagination: {
          total,
          limit: parseInt(limit as string),
          skip: parseInt(skip as string),
          hasMore: (parseInt(skip as string) + parseInt(limit as string)) < total
        }
      }
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch conversations'
    });
  }
});

/**
 * GET /api/conversations/:sessionId - ดึง conversation เฉพาะ
 */
router.get('/conversations/:sessionId', async (req: Request, res: Response): Promise<any> => {
  try {
    const { sessionId } = req.params;
    
    const conversation = await Conversation.findOne({ sessionId }).lean();
    
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    const user = await User.findOne({ lineUserId: conversation.lineUserId }).lean();

    res.json({
      success: true,
      data: {
        ...conversation,
        user: user ? {
          name: user.name,
          employeeId: user.employeeId,
          department: user.department
        } : null
      }
    });
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch conversation'
    });
  }
});

/**
 * GET /api/users - ดึงรายการ users
 */
router.get('/users', async (req: Request, res: Response) => {
  try {
    const { limit = '50', skip = '0' } = req.query;

    const users = await User.find()
      .sort({ registeredAt: -1 })
      .limit(parseInt(limit as string))
      .skip(parseInt(skip as string))
      .lean();

    const total = await User.countDocuments();

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          total,
          limit: parseInt(limit as string),
          skip: parseInt(skip as string),
          hasMore: (parseInt(skip as string) + parseInt(limit as string)) < total
        }
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

/**
 * GET /api/issues - สรุปปัญหาที่พบบ่อย
 */
router.get('/issues', async (req: Request, res: Response) => {
  try {
    const { limit = '10' } = req.query;

    const issues = await Conversation.aggregate([
      { $match: { 
          issue: { $nin: ['', null, 'ไม่ระบุ', 'ไม่สามารถสรุปปัญหาได้'] } 
      } },
      { 
        $group: {
          _id: '$issue',
          count: { $sum: 1 },
          avgRating: { $avg: '$rating' },
          resolvedCount: {
            $sum: { $cond: ['$resolved', 1, 0] }
          },
          escalatedCount: {
            $sum: { $cond: ['$escalated', 1, 0] }
          }
        }
      },
      { $sort: { count: -1 } },
      { $limit: parseInt(limit as string) }
    ]);

    res.json({
      success: true,
      data: issues.map(issue => ({
        issue: issue._id,
        count: issue.count,
        averageRating: issue.avgRating ? parseFloat(issue.avgRating.toFixed(2)) : null,
        resolvedCount: issue.resolvedCount,
        escalatedCount: issue.escalatedCount,
        resolutionRate: ((issue.resolvedCount / issue.count) * 100).toFixed(2)
      }))
    });
  } catch (error) {
    console.error('Error fetching issues:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch issues'
    });
  }
});

/**
 * GET /api/ratings - กระจายของ ratings
 */
router.get('/ratings', async (req: Request, res: Response) => {
  try {
    const ratingDistribution = await Conversation.aggregate([
      { $match: { rating: { $ne: null } } },
      {
        $group: {
          _id: '$rating',
          count: { $sum: 1 }
        }
      }
    ]);

    const distribution = [1, 2, 3, 4, 5].map(rating => {
      const found = ratingDistribution.find(r => r._id === rating);
      return {
        rating,
        count: found ? found.count : 0
      };
    });

    res.json({
      success: true,
      data: distribution
    });
  } catch (error) {
    console.error('Error fetching ratings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch ratings'
    });
  }
});

/**
 * GET /api/tickets - ดึงรายการการแจ้งเคส IT (Tickets)
 */
router.get('/tickets', async (req: Request, res: Response) => {
  try {
    const { limit = '50', skip = '0', status } = req.query;

    const filter: any = {};
    if (status !== undefined) {
      filter.status = parseInt(status as string, 10);
    }

    const tickets = await Ticket.find(filter)
      .sort({ reportedAt: -1 })
      .limit(parseInt(limit as string))
      .skip(parseInt(skip as string))
      .lean();

    const total = await Ticket.countDocuments(filter);

    res.json({
      success: true,
      data: {
        tickets,
        pagination: {
          total,
          limit: parseInt(limit as string),
          skip: parseInt(skip as string),
          hasMore: (parseInt(skip as string) + parseInt(limit as string)) < total
        }
      }
    });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tickets'
    });
  }
});

/**
 * PUT /api/tickets/:id/status - อัปเดตสถานะของ Ticket
 * Body: { status: 0 | 1 }
 */
router.put('/tickets/:id/status', async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (status !== 0 && status !== 1) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status value. Must be 0 or 1.'
      });
    }

    const updatedTicket = await Ticket.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );

    if (!updatedTicket) {
      return res.status(404).json({
        success: false,
        error: 'Ticket not found'
      });
    }

    res.json({
      success: true,
      data: updatedTicket
    });
  } catch (error) {
    console.error('Error updating ticket status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update ticket status'
    });
  }
});

export default router;
