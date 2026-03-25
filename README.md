# LINE IT Support Bot with Gemini AI

Bot LINE ช่วยเหลือด้าน IT Support ด้วย Google Gemini AI พร้อมระบบประเมินความพึงพอใจและเก็บข้อมูลการสนทนา

## Features

✅ **การลงทะเบียน User**
- เก็บข้อมูล: ชื่อ, รหัสพนักงาน, แผนก

✅ **AI Assistant**
- ตอบคำถามด้าน IT Support ด้วย Google Gemini
- ให้คำแนะนำแบบ step-by-step

✅ **Conversation Management**
- เก็บประวัติการสนทนาทั้งหมด
- สรุปปัญหาอัตโนมัติ
- ติดตามสถานะการแก้ปัญหา

✅ **Rating System**
- ให้ user ประเมินความพึงพอใจ (1-5 ดาว)
- เก็บ feedback

✅ **Escalation**
- ส่งต่อไปยังเจ้าหน้าที่จริงเมื่อ AI แก้ไม่ได้

✅ **Analytics API**
- สถิติการใช้งาน
- ปัญหาที่พบบ่อย
- Rating distribution

## Tech Stack

- **Runtime**: Bun.js
- **Framework**: Express.js
- **Database**: MongoDB + Mongoose
- **AI**: Google Gemini 1.5 Flash
- **Messaging**: LINE Messaging API

## Installation

### 1. ติดตั้ง Bun (ถ้ายังไม่มี)

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. Clone และติดตั้ง dependencies

```bash
cd line-it-support-bot
bun install
```

### 3. ตั้งค่า Environment Variables

สร้างไฟล์ `.env` จาก `.env.example`:

```bash
cp .env.example .env
```

แก้ไขค่าใน `.env`:

```env
# LINE Messaging API - รับจาก LINE Developers Console
LINE_CHANNEL_ACCESS_TOKEN=your_token_here
LINE_CHANNEL_SECRET=your_secret_here

# Google Gemini API - รับจาก Google AI Studio
GEMINI_API_KEY=your_gemini_key_here

# MongoDB
MONGODB_URI=mongodb://localhost:27017/line-it-support

# Server
PORT=3000

# IT Support Contact
IT_SUPPORT_LINE_URL=https://line.me/ti/p/your-it-line
```

### 4. เริ่มใช้งาน MongoDB

```bash
# ถ้าใช้ Docker
docker run -d -p 27017:27017 --name mongodb mongo:latest

# หรือติดตั้งแบบ local
# macOS
brew install mongodb-community
brew services start mongodb-community

# Ubuntu
sudo systemctl start mongod
```

### 5. รัน Application

```bash
# Development mode (auto-reload)
bun run dev

# Production mode
bun start
```

## LINE Bot Setup

### 1. สร้าง LINE Bot

1. ไปที่ [LINE Developers Console](https://developers.line.biz/)
2. สร้าง Provider และ Channel (Messaging API)
3. คัดลอก **Channel Access Token** และ **Channel Secret**

### 2. ตั้งค่า Webhook

1. ใน LINE Developers Console
2. ไปที่ Messaging API settings
3. ตั้ง Webhook URL: `https://your-domain.com/webhook`
4. เปิดใช้งาน Webhook

**สำหรับ Local Development** ใช้ ngrok:

```bash
ngrok http 3000
```

จะได้ URL แบบ: `https://xxxx.ngrok.io`  
ตั้งค่า Webhook เป็น: `https://xxxx.ngrok.io/webhook`

### 3. ตั้งค่า Auto-reply

1. ปิด "Auto-reply messages" ใน LINE Official Account Manager
2. เปิด "Webhook"

## Google Gemini Setup

1. ไปที่ [Google AI Studio](https://makersuite.google.com/app/apikey)
2. สร้าง API Key
3. คัดลอกมาใส่ใน `.env`

## API Endpoints

### 📊 Statistics

```
GET /api/stats
```

Response:
```json
{
  "success": true,
  "data": {
    "totalUsers": 150,
    "totalConversations": 320,
    "resolvedConversations": 280,
    "escalatedConversations": 15,
    "resolutionRate": 87.5,
    "averageRating": 4.3,
    "totalRatings": 250
  }
}
```

### 💬 Conversations

```
GET /api/conversations?limit=50&skip=0&status=closed&resolved=true
```

Parameters:
- `limit` - จำนวนที่ต้องการดึง (default: 50)
- `skip` - pagination offset
- `status` - active, waiting_rating, closed
- `resolved` - true/false

### 🔍 Conversation Detail

```
GET /api/conversations/:sessionId
```

### 👥 Users

```
GET /api/users?limit=50&skip=0
```

### 🐛 Common Issues

```
GET /api/issues?limit=10
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "issue": "ลืมรหัสผ่าน Windows",
      "count": 45,
      "averageRating": 4.5,
      "resolvedCount": 42,
      "escalatedCount": 3,
      "resolutionRate": "93.33"
    }
  ]
}
```

### ⭐ Rating Distribution

```
GET /api/ratings
```

## User Flow

### การใช้งานครั้งแรก

1. User เพิ่ม LINE Bot เป็นเพื่อน
2. ส่งข้อความอะไรก็ได้ → ระบบจะให้กรอกข้อมูล:
   - ชื่อ-นามสกุล
   - รหัสพนักงาน
   - แผนก/ฝ่าย
3. ลงทะเบียนสำเร็จ → พร้อมใช้งาน

### การสนทนา

1. User พิมพ์คำถาม/ปัญหา
2. AI ตอบและให้คำแนะนำ
3. หลังจากสนทนา 4 ข้อความ → ถามว่าแก้ได้หรือยัง
4. User เลือก:
   - ✅ แก้ได้แล้ว → ให้ rating 1-5 ดาว
   - ❌ ยังไม่ได้ → สนทนาต่อ
   - 👤 ติดต่อเจ้าหน้าที่ → ส่งต่อ

### คำสั่งพิเศษ

- `/start` - เริ่มสนทนาใหม่
- `/help` - แสดงคำแนะนำ
- `ติดต่อเจ้าหน้าที่` - escalate ไปยังทีม IT

## Database Schema

### Users Collection

```javascript
{
  lineUserId: String,
  name: String,
  employeeId: String,
  department: String,
  registeredAt: Date,
  isActive: Boolean
}
```

### Conversations Collection

```javascript
{
  lineUserId: String,
  sessionId: String,
  messages: [{
    role: 'user' | 'assistant' | 'system',
    content: String,
    timestamp: Date
  }],
  issue: String,
  resolved: Boolean,
  rating: Number (1-5),
  feedback: String,
  escalated: Boolean,
  status: 'active' | 'waiting_rating' | 'closed',
  createdAt: Date,
  closedAt: Date
}
```

## Project Structure

```
line-it-support-bot/
├── src/
│   ├── app.js                 # Main application
│   ├── config/
│   │   └── database.js        # MongoDB connection
│   ├── models/
│   │   ├── User.js            # User model
│   │   └── Conversation.js    # Conversation model
│   ├── services/
│   │   ├── gemini.js          # Gemini AI service
│   │   └── line.js            # LINE messaging service
│   └── routes/
│       └── api.js             # API routes
├── package.json
├── .env.example
└── README.md
```

## Customization

### ปรับแต่ง AI Prompt

แก้ไขใน `src/services/gemini.js`:

```javascript
const SYSTEM_PROMPT = `คุณเป็น AI Assistant สำหรับ IT Support...`;
```

### เพิ่มคำสั่งพิเศษ

แก้ไขใน `src/services/line.js` ใน method `handleMessage()`

### ปรับเงื่อนไขถามความพึงพอใจ

แก้ไขใน `src/services/line.js`:

```javascript
// ถามหลัง 4 ข้อความ -> เปลี่ยนเป็นค่าที่ต้องการ
if (conversation.messages.length >= 4) {
  // ...
}
```

## Monitoring & Logs

ดู logs:

```bash
# ถ้ารันด้วย bun run dev
# logs จะแสดงใน console

# ถ้ารันด้วย PM2
pm2 logs line-it-support-bot
```

## Deployment

### Deploy to Production Server

```bash
# ติดตั้ง PM2
bun add -g pm2

# Start with PM2
pm2 start src/app.js --name line-it-support-bot --interpreter bun

# Save PM2 config
pm2 save
pm2 startup
```

### Environment

- ใช้ HTTPS (SSL) สำหรับ webhook
- ตั้งค่า MongoDB replica set สำหรับ production
- ใช้ Redis cache ถ้าจำเป็น

## Troubleshooting

### Bot ไม่ตอบ

1. ตรวจสอบ Webhook URL ถูกต้องหรือไม่
2. ดู logs ว่ามี error อะไร
3. ตรวจสอบ LINE_CHANNEL_ACCESS_TOKEN และ LINE_CHANNEL_SECRET

### Gemini API Error

1. ตรวจสอบ API Key
2. ตรวจสอบ quota/limit
3. ดู error message ใน logs

### MongoDB Connection Failed

1. ตรวจสอบ MongoDB รันอยู่หรือไม่
2. ตรวจสอบ MONGODB_URI
3. ตรวจสอบ network/firewall

## License

MIT

## Support

หากมีปัญหาหรือข้อสงสัย:
- เปิด Issue ใน GitHub
- ติดต่อทีมพัฒนา
