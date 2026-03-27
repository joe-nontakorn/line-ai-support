import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { middleware, WebhookEvent } from '@line/bot-sdk';
import { Client } from '@line/bot-sdk';
import connectDB from './config/mongodb.js';
import { LineService } from './services/line.js';
import apiRoutes from './routes/api.js';

const app = express();
const PORT = process.env.PORT;

// LINE Bot Configuration
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN as string,
  channelSecret: process.env.LINE_CHANNEL_SECRET as string
};

const lineClient = new Client(lineConfig);
const lineService = new LineService(lineClient);

// Connect to MongoDB
connectDB().catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});

// LINE Webhook ต้องอยู่ก่อน express.json() เพื่อให้ middleware สามารถอ่าน raw body ไปตรวจสอบ signature ได้
app.post('/webhook', middleware(lineConfig) as any, async (req: Request, res: Response) => {
  try {
    const events: WebhookEvent[] = req.body.events;

    await Promise.all(
      events.map(async (event: WebhookEvent) => {
        if (event.type === 'message') {
          // ป้องกัน bot ทำงานกับข้อความใน group/room (ให้ bot ส่งข้อมูลไปเฉยๆ โดยไม่ตอบโต้ในกลุ่ม)
          if (event.source.type === 'group' || event.source.type === 'room') {
            console.log(`Received message in group/room. ID: ${(event.source as any).groupId || (event.source as any).roomId}`);
            return;
          }

          const messageType = event.message.type;

          // รองรับ text, image, file, sticker
          if (['text', 'image', 'file', 'sticker'].includes(messageType)) {
            await lineService.handleMessage(event);
          } else {
            // message type อื่นๆ ที่ไม่รองรับ
            console.log(`Unsupported message type: ${messageType}`);
          }
        } else if (event.type === 'join') {
          // เมื่อ Bot ถูกดึงเข้ากลุ่ม ให้พิมพ์ ID กลุ่มออกมาเพื่อนำไปใส่ ADMIN_GROUP_ID
          console.log(`Bot joined a ${event.source.type}! ID: ${(event.source as any).groupId || (event.source as any).roomId}`);
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
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📍 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`📊 API URL: http://localhost:${PORT}/api`);
});

export default app;
