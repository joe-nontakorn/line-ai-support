import 'dotenv/config';
import express from 'express';
import { middleware } from '@line/bot-sdk';
import { Client } from '@line/bot-sdk';
import connectDB from './config/database.js';
import { LineService } from './services/line.js';
import apiRoutes from './routes/api.js';

const app = express();
const PORT = process.env.PORT || 3000;

// LINE Bot Configuration
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const lineClient = new Client(lineConfig);
const lineService = new LineService(lineClient);

// Connect to MongoDB
connectDB().catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'LINE IT Support Bot',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api', apiRoutes);

// LINE Webhook
app.post('/webhook', middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events;
    
    await Promise.all(
      events.map(async (event) => {
        // รองรับ message event หลายประเภท
        if (event.type === 'message') {
          const messageType = event.message.type;
          
          // รองรับ text, image, file
          if (['text', 'image', 'file'].includes(messageType)) {
            await lineService.handleMessage(event);
          } else {
            // message type อื่นๆ ที่ไม่รองรับ
            console.log(`Unsupported message type: ${messageType}`);
          }
        }
      })
    );

    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ 
      status: 'error',
      message: error.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
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