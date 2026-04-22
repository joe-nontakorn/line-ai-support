import express, { Request, Response } from 'express';
import User from '../models/User.js';
import Conversation from '../models/Conversation.js';
import Ticket from '../models/Ticket.js';
import Notification from '../models/Notification.js';
import { lineClient } from '../services/line/client.js';
import { MessagingService } from '../services/line/messaging.js';
import { logger } from '../utils/logger.js';
import multer from 'multer';
import { getUploadDir, getFilePublicUrl } from '../utils/storage.js';
import path from 'path';
import { Message } from '@line/bot-sdk';

const router = express.Router();
const messagingService = new MessagingService(lineClient);

// Setup multer for file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, getUploadDir());
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

/**
 * GET /api/stats - สถิติรวมของระบบ
 */
router.get('/stats', async (_req: Request, res: Response) => {
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
 * GET /api/conversations - ดึงรายการ conversations พร้อม Pagination
 */
router.get('/conversations', async (req: Request, res: Response) => {
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

/**
 * GET /api/tickets - ดึงรายการ tickets พร้อม Pagination
 */
router.get('/tickets', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;
    const { status } = req.query;
    
    const filter: any = {};
    if (status) filter.status = status;

    const [tickets, total] = await Promise.all([
      Ticket.find(filter)
        .sort({ reportedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Ticket.countDocuments(filter)
    ]);

    res.json({ 
      success: true, 
      data: {
        tickets,
        pagination: {
          total,
          limit,
          page,
          totalPages: Math.ceil(total / limit),
          hasMore: skip + tickets.length < total
        }
      } 
    });
  } catch (error) {
    logger.error('Error fetching tickets:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch tickets' });
  }
});

/**
 * GET /api/tickets/:ticketId - ดึงรายละเอียด Ticket รายใบ
 */
router.get('/tickets/:ticketId', async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;
    const ticket = await Ticket.findOne({ ticketId }).lean();
    
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    res.json({ success: true, data: ticket });
  } catch (error) {
    logger.error('Error fetching ticket detail:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch ticket detail' });
  }
});

/**
 * GET /api/issues - สรุปปัญหาที่ผู้ใช้แจ้งบ่อย
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

    res.json({ success: true, data: formattedStats });
  } catch (error) {
    logger.error('Error fetching issue stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch issue stats' });
  }
});

/**
 * GET /api/ratings - ดึงคะแนนความพึงพอใจทั้งหมด
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
      const found = ratingStats.find(item => item.rating === r);
      return found || { rating: r, count: 0 };
    });

    res.json({ success: true, data: fullStats });
  } catch (error) {
    logger.error('Error fetching rating stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch rating stats' });
  }
});

/**
 * GET /api/trends - ดึงแนวโน้มเคสรายวัน (7 วันย้อนหลัง)
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

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Error fetching trends:', error);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

/**
 * GET /api/activity - กิจกรรมล่าสุด
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

    res.json({ success: true, data: activities.slice(0, 15) });
  } catch (error) {
    logger.error('Error fetching activity:', error);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

/**
 * GET /api/users - ดึงรายการผู้ใช้ทั้งหมดพร้อม Pagination
 */
router.get('/users', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 15;
    const search = req.query.search as string;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } }
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ registeredAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          total,
          limit,
          page,
          totalPages: Math.ceil(total / limit),
          hasMore: skip + users.length < total
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

/**
 * PUT /api/tickets/:ticketId/status - อัปเดตสถานะ Ticket และส่ง LINE แจ้งเตือน (รองรับไฟล์แนบ)
 */
router.put('/tickets/:ticketId/status', upload.array('files', 5), async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;
    const { status, resolutionComment, staffName = '' } = req.body;
    const files = req.files as Express.Multer.File[];

    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    const user = await User.findOne({ employeeId: ticket.employeeId });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // จัดการไฟล์แนบ
    const attachments: any[] = [];
    if (files && files.length > 0) {
      files.forEach(file => {
        const isImage = file.mimetype.startsWith('image/');
        attachments.push({
          url: getFilePublicUrl(file.filename),
          type: isImage ? 'image' : 'file',
          filename: file.originalname,
          size: file.size
        });
      });
    }

    const oldStatus = ticket.status;
    ticket.status = status;
    if (resolutionComment) ticket.resolutionComment = resolutionComment;
    
    if (status === 'in_progress' && !ticket.acceptedAt) {
      ticket.acceptedAt = new Date();
    }
    if (status === 'resolved' || status === 'waiting_user_confirm') {
      ticket.resolvedAt = new Date();
    }

    // บันทึกประวัติสถานะ
    ticket.statusHistory.push({
      status,
      changedAt: new Date(),
      changedBy: staffName,
      comment: resolutionComment || `Changed status from ${oldStatus} to ${status}`,
      attachments
    });

    // เพิ่มไฟล์แนบรวมของ Ticket
    if (attachments.length > 0) {
      ticket.attachments.push(...attachments);
    }

    await ticket.save();

    // --- ส่ง LINE แจ้งเตือน ---
    const staffLabel = staffName ? ` (โดย ${staffName})` : '';
    let message = '';
    const lineMessages: Message[] = [];

    if (status === 'in_progress') {
      message = 
        `✅ IT ได้รับเรื่องแล้ว!${staffLabel}\n\n` +
        `🎫 Ticket: ${ticket.ticketId}\n` +
        `📝 ปัญหา: ${ticket.issueSummary}\n\n` +
        `สถานะ: กำลังดำเนินการ 🔧\n` +
        `เจ้าหน้าที่กำลังตรวจสอบและแก้ไขปัญหาให้คุณครับ`;
      lineMessages.push({ type: 'text', text: message });
    } else if (status === 'waiting_user_confirm') {
      message = 
        `🛠️ เจ้าหน้าที่แจ้งแก้ไขงานเรียบร้อยแล้ว!${staffLabel}\n\n` +
        `🎫 Ticket: ${ticket.ticketId}\n` +
        `📝 ปัญหา: ${ticket.issueSummary}\n\n` +
        `✅ วิธีแก้: ${resolutionComment || 'ดำเนินการแก้ไขเรียบร้อย'}\n\n` +
        `กรุณายืนยันว่าปัญหาได้รับการแก้ไขแล้วหรือไม่ครับ? 👇`;
      
      const quickReply = {
        items: [
          { type: 'action', action: { type: 'message', label: '✅ ใช่ แก้ไขแล้ว', text: `ยืนยันปิดเคส ${ticket.ticketId}` } },
          { type: 'action', action: { type: 'message', label: '❌ ยังพบปัญหาอยู่', text: `เคส ${ticket.ticketId} ยังเสียอยู่` } }
        ]
      };
      lineMessages.push({ type: 'text', text: message, quickReply } as any);
    } else if (status === 'resolved') {
      message = 
        `🎉 เคสของคุณได้รับการแก้ไขเรียบร้อยแล้ว!${staffLabel}\n\n` +
        `🎫 Ticket: ${ticket.ticketId}\n` +
        `📝 ปัญหา: ${ticket.issueSummary}\n\n` +
        `✅ วิธีแก้ไข: ${resolutionComment || 'ดำเนินการแก้ไขเรียบร้อย'}\n\n` +
        `สถานะ: สำเร็จ ✨`;
      lineMessages.push({ type: 'text', text: message });
    }

    // เพิ่มรูปภาพหรือไฟล์ PDF ลงในชุดข้อความ LINE
    if (attachments.length > 0) {
      attachments.forEach(att => {
        if (lineMessages.length < 5) {
          if (att.type === 'image') {
            lineMessages.push({
              type: 'image',
              originalContentUrl: att.url,
              previewImageUrl: att.url
            });
          } else if (att.type === 'file') {
            lineMessages.push({
              type: 'flex',
              altText: `ไฟล์แนบ: ${att.filename}`,
              contents: {
                type: 'bubble',
                body: {
                  type: 'box',
                  layout: 'vertical',
                  spacing: 'md',
                  contents: [
                    {
                      type: 'text',
                      text: att.filename,
                      weight: 'bold',
                      size: 'md',
                      wrap: true
                    },
                    {
                      type: 'text',
                      text: att.size ? `${(att.size / (1024 * 1024)).toFixed(2)} MB` : '',
                      size: 'xs',
                      color: '#888888'
                    },
                    {
                      type: 'button',
                      action: {
                        type: 'uri',
                        label: 'ดาวน์โหลด / เปิดไฟล์',
                        uri: att.url
                      },
                      style: 'primary',
                      height: 'sm',
                      color: '#007bff',
                      margin: 'md'
                    }
                  ]
                }
              }
            } as any);
          }
        }
      });
    }

    // ย้าย QuickReply ไปไว้ที่ข้อความสุดท้ายเสมอ และตรวจสอบประเภทที่รองรับ
    if (lineMessages.length > 0) {
      const msgWithQR = lineMessages.find(m => m.quickReply);
      if (msgWithQR) {
        const qr = msgWithQR.quickReply;
        delete msgWithQR.quickReply;
        
        const lastMsg = lineMessages[lineMessages.length - 1];
        // ประเภทที่รองรับ Quick Reply: text, image, video, audio, location, template, flex
        const supportedTypes = ['text', 'image', 'video', 'audio', 'location', 'template', 'flex'];
        
        if (supportedTypes.includes(lastMsg.type)) {
          lastMsg.quickReply = qr;
        } else {
          // ถ้าใบสุดท้ายไม่รองรับ (เช่น file/pdf) ให้เพิ่มข้อความ text สั้นๆ ตบท้ายเพื่อถือปุ่มแทน
          lineMessages.push({
            type: 'text',
            text: 'กรุณายืนยันผลการแก้ไขด้านบนครับ 👇',
            quickReply: qr
          } as any);
        }
      }
    }

    if (lineMessages.length > 0) {
      logger.info(`Sending ${lineMessages.length} messages to user ${user.lineUserId}:`, JSON.stringify(lineMessages, null, 2));
      await messagingService.pushMultipleMessages(user.lineUserId, lineMessages);
    }

    // --- สร้าง Notification สำหรับ Dashboard ---
    if (status === 'resolved' || status === 'waiting_user_confirm') {
      await Notification.create({
        type: 'resolved_ticket',
        title: status === 'resolved' ? 'เคสแก้ไขสำเร็จแล้ว' : 'เจ้าหน้าที่แจ้งแก้ไขงาน',
        content: `${ticket.name}: ${ticket.issueSummary.split('\n')[0]}`,
        metadata: { ticketId: ticket.ticketId, _id: ticket._id },
        timestamp: new Date()
      });
    }

    res.json({ success: true, data: ticket });
  } catch (error) {
    logger.error('Error updating ticket status:', error);
    res.status(500).json({ success: false, error: 'Failed to update ticket status' });
  }
});

/**
 * GET /api/notifications - ดึงประวัติแจ้งเตือนย้อนหลัง
 */
router.get('/notifications', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const notifications = await Notification.find()
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    
    res.json({ success: true, data: notifications });
  } catch (error) {
    logger.error('Error fetching notifications:', error);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

/**
 * PUT /api/notifications/:id/read - ทำเครื่องหมายว่าอ่านแล้ว
 */
router.put('/notifications/:id/read', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await Notification.findByIdAndUpdate(id, { isRead: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

/**
 * PUT /api/notifications/read-all - ทำเครื่องหมายว่าอ่านแล้วทั้งหมด
 */
router.put('/notifications/read-all', async (_req: Request, res: Response) => {
  try {
    await Notification.updateMany({ isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

/**
 * DELETE /api/notifications - ล้างประวัติแจ้งเตือน
 */
router.delete('/notifications', async (_req: Request, res: Response) => {
  try {
    await Notification.deleteMany({});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

export default router;
