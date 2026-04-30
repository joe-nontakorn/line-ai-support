// src/routes/tickets.ts
import express, { Request, Response } from 'express';
import Ticket from '../models/Ticket.js';
import User from '../models/User.js';
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
 * GET /api/tickets - ดึงรายการ tickets พร้อม Pagination
 */
router.get('/', async (req: Request, res: Response) => {
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
        .limit(limit)
        .skip(skip)
        .lean(),
      Ticket.countDocuments(filter)
    ]);

    // Enrich with category stats
    const categoryStats = await Ticket.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.json({
      success: true,
      message: 'OK',
      results: tickets.length,
      data: {
        tickets,
        pagination: {
          total,
          limit,
          page,
          totalPages: Math.ceil(total / limit),
          hasMore: skip + tickets.length < total
        },
        categoryStats: categoryStats.map(c => ({ category: c._id || 'Uncategorized', count: c.count }))
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
router.get('/:ticketId', async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;
    const ticket = await Ticket.findOne({ ticketId }).lean();
    
    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    res.json({ success: true, message: 'OK', results: 1, data: ticket });
  } catch (error) {
    logger.error('Error fetching ticket detail:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch ticket detail' });
  }
});

/**
 * PUT /api/tickets/:ticketId/status - อัปเดตสถานะ Ticket และส่ง LINE แจ้งเตือน (รองรับไฟล์แนบ)
 */
router.put('/:ticketId/status', upload.array('files', 5), async (req: Request, res: Response) => {
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
        `🛠️ เจ้าหน้าที่ได้ดำเนินการแก้ไขปัญหาเรียบร้อยแล้ว!${staffLabel}\n\n` +
        `🎫 Ticket: ${ticket.ticketId}\n` +
        `📝 ปัญหา: ${ticket.issueSummary}\n\n` +
        `✅ วิธีแก้: ${resolutionComment || 'ดำเนินการแก้ไขปัญหาเรียบร้อย'}\n\n` +
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
        title: 'ดำเนินการแก้ไขปัญหาสำเร็จ',
        content: `${ticket.issueSummary.split('\n')[0]}\nผู้แจ้ง: ${ticket.name}`,
        metadata: { ticketId: ticket.ticketId, _id: ticket._id },
        timestamp: new Date()
      });
    }

    res.json({ success: true, message: 'OK', results: 1, data: ticket });
  } catch (error) {
    logger.error('Error updating ticket status:', error);
    res.status(500).json({ success: false, error: 'Failed to update ticket status' });
  }
});

export default router;
