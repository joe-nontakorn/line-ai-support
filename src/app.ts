import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { middleware, WebhookEvent } from '@line/bot-sdk';
import { Client } from '@line/bot-sdk';
import connectDB from './config/mongodb.js';
import { LineService } from './services/line.js';
import apiRoutes from './routes/api.js';
import cors from 'cors';

const app = express();
const PORT = parseInt(process.env.PORT || '3002', 10);

// LINE Bot Configuration
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN as string,
  channelSecret: process.env.LINE_CHANNEL_SECRET as string
};

const lineClient = new Client(lineConfig);
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
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});

import crypto from 'crypto';

// LINE Webhook route
app.post('/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    // Manual signature validation to avoid generic raw-body issues in Bun
    const signature = req.headers['x-line-signature'] as string;
    const channelSecret = lineConfig.channelSecret;
    const body = req.body; // Buffer from express.raw()

    if (!signature) {
      res.status(401).send('Signature missing');
      return;
    }

    const expectedSignature = crypto.createHmac('SHA256', channelSecret).update(body).digest('base64');
    if (signature !== expectedSignature) {
      console.error('SignatureValidationFailed: signature validation failed');
      res.status(401).send('SignatureValidationFailed');
      return;
    }

    const bodyJson = JSON.parse(body.toString('utf8'));
    const events: WebhookEvent[] = bodyJson.events;

    await Promise.all(
      events.map(async (event: WebhookEvent) => {
        if (event.type === 'message') {
          // ป้องกัน bot ทำงานกับข้อความใน group/room (ให้ bot ส่งข้อมูลไปเฉยๆ โดยไม่ตอบโต้ในกลุ่ม)
          if (event.source.type === 'group' || event.source.type === 'room') {
            const groupId = (event.source as any).groupId || (event.source as any).roomId;
            console.log(`Received message in group/room. ID: ${groupId}`);
            return;
          }

          const messageType = event.message.type;
          // รองรับ text, image, file, sticker
          if (['text', 'image', 'file', 'sticker'].includes(messageType)) {
            await lineService.handleMessage(event);
          } else {
            console.log(`Unsupported message type: ${messageType}`);
          }
        } else if (event.type === 'join') {
          // เมื่อ Bot ถูกดึงเข้ากลุ่ม ให้พิมพ์ ID กลุ่มออกมาเพื่อนำไปใส่ ADMIN_GROUP_ID
          console.log(`Bot joined a ${event.source.type}! ID: ${(event.source as any).groupId || (event.source as any).roomId}`);
        } else if (event.type === 'leave') {
          console.log(`Bot left a ${event.source.type}! ID: ${(event.source as any).groupId || (event.source as any).roomId}. Either kicked or API setting denies group join.`);
        } else if (event.type === 'follow') {
          await lineService.handleFollow(event);
        } else {
          console.log(`Received event type: ${event.type}`);
        }
      })
    );

    res.json({ status: 'ok' });
  } catch (error: any) {
    console.error('Webhook error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
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



// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});



// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📍 Webhook URL: http://0.0.0.0:${PORT}/webhook`);
  console.log(`📊 API URL: http://0.0.0.0:${PORT}/api`);
});

export default app;
