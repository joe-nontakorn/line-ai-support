import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { middleware, WebhookEvent } from '@line/bot-sdk';
import { Client } from '@line/bot-sdk';
import connectDB from './config/mongodb.js';
import { LineService } from './services/line.js';
import { lineClient } from './services/line/client.js';
import apiRoutes from './routes/api.js';
import cors from 'cors';
import { logger } from './utils/logger.js';
import { ensureUploadDir, getUploadDir } from './utils/storage.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3002', 10);

// LINE Bot Configuration
const channelSecret = process.env.LINE_CHANNEL_SECRET as string;

const lineService = new LineService(lineClient);


app.use(cors({
  origin: [
    'http://localhost:5173',          // Vite dev
    'http://asset.jastel.internal',   // Production frontend
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
// Connect to MongoDB
connectDB().catch(err => {
  logger.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});

import crypto from 'crypto';

// LINE Webhook route
app.post('/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    // Manual signature validation to avoid generic raw-body issues in Bun
    const signature = req.headers['x-line-signature'] as string;
    const body = req.body; // Buffer from express.raw()

    if (!signature) {
      res.status(401).send('Signature missing');
      return;
    }

    const expectedSignature = crypto.createHmac('SHA256', channelSecret).update(body).digest('base64');
    if (signature !== expectedSignature) {
      logger.error('SignatureValidationFailed: signature validation failed');
      res.status(401).send('SignatureValidationFailed');
      return;
    }

    const bodyJson = JSON.parse(body.toString('utf8'));
    const events: WebhookEvent[] = bodyJson.events;

    // ตอบกลับ LINE ทันที (ป้องกัน Timeout 1-3 วินาที ที่ทำให้ LINE ส่ง Webhook ซ้ำ และทำให้ AI สร้าง Ticket เบิ้ล หรือติดปัญหา Token Rate Limit)
    res.status(200).json({ status: 'ok' });

    // ประมวลผลในเบื้องหลัง
    Promise.all(
      events.map(async (event: WebhookEvent) => {
        if (event.type === 'message') {
          // ป้องกัน bot ทำงานกับข้อความใน group/room
          if (event.source.type === 'group' || event.source.type === 'room') {
            const groupId = (event.source as any).groupId || (event.source as any).roomId;
            logger.info(`Received message in group/room. ID: ${groupId}`);
            return;
          }

          const messageType = event.message.type;
          // รองรับ text, image, file, sticker
          if (['text', 'image', 'file', 'sticker'].includes(messageType)) {
            await lineService.handleMessage(event);
          } else {
            logger.warn(`Unsupported message type: ${messageType}`);
          }
        } else if (event.type === 'join') {
          logger.info(`Bot joined a ${event.source.type}! ID: ${(event.source as any).groupId || (event.source as any).roomId}`);
        } else if (event.type === 'leave') {
          logger.info(`Bot left a ${event.source.type}! ID: ${(event.source as any).groupId || (event.source as any).roomId}`);
        } else if (event.type === 'follow') {
          await lineService.handleFollow(event);
        } else {
          logger.info(`Received event type: ${event.type}`);
        }
      })
    ).catch(err => {
      logger.error('Background Webhook processing error:', err);
    });

  } catch (error: any) {
    logger.error('Webhook payload error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        status: 'error',
        message: error.message
      });
    }
  }
});

// Middleware สำหรับ API อื่นๆ ที่ไม่ใช่ Webhook
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'LINE IT AI Support',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api', apiRoutes);

// Static files (Uploads)
app.use('/uploads', express.static(getUploadDir()));



// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});



import { startTicketAutoCloseWorker } from './services/ticketAutoClose.js';

// Start server
app.listen(PORT, '0.0.0.0', () => {
  ensureUploadDir();
  logger.info(`🚀 Server is running on port ${PORT}`);
  logger.info(`📍 Webhook URL: http://0.0.0.0:${PORT}/webhook`);
  logger.info(`📊 API URL: http://0.0.0.0:${PORT}/api`);
  
  // Start background worker for auto-closing tickets
  startTicketAutoCloseWorker().catch(err => {
    logger.error('Failed to start Ticket Auto-Close Worker:', err);
  });
});

export default app;
