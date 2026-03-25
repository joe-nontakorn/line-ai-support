# 📦 LINE IT Support Bot - Project Summary

## 🎯 Overview

ระบบ LINE Chatbot สำหรับ IT Support ที่ขับเคลื่อนด้วย Google Gemini AI พร้อมระบบจัดเก็บข้อมูล การประเมินความพึงพอใจ และการส่งต่อไปยังเจ้าหน้าที่

## ✨ Features Implemented

### ✅ User Registration System
- เก็บข้อมูล: ชื่อ, รหัสพนักงาน, แผนก
- ลงทะเบียนครั้งเดียว ใช้ได้ตลอด
- Validation และ error handling

### ✅ AI-Powered IT Support
- Integration กับ Google Gemini 1.5 Flash
- Conversational AI ตอบคำถามด้าน IT
- Context-aware (จำบริบทการสนทนา)
- ให้คำแนะนำแบบ step-by-step

### ✅ Conversation Management
- เก็บประวัติการสนทนาทั้งหมดใน MongoDB
- สรุปปัญหาอัตโนมัติด้วย AI
- Track สถานะ: active, waiting_rating, closed

### ✅ Rating & Feedback System
- ให้ user ประเมินความพึงพอใจ 1-5 ดาว
- Quick Reply buttons สำหรับให้คะแนนง่าย
- เก็บ feedback เพื่อวิเคราะห์

### ✅ Escalation System
- ตรวจจับเมื่อ AI ไม่สามารถแก้ปัญหาได้
- ส่งต่อไปยังเจ้าหน้าที่จริง
- ให้ข้อมูล contact (LINE, โทรศัพท์, อีเมล)

### ✅ Analytics API
- **GET /api/stats** - สถิติรวม (users, conversations, resolution rate, avg rating)
- **GET /api/conversations** - รายการการสนทนา (พร้อม pagination, filters)
- **GET /api/conversations/:id** - รายละเอียดการสนทนา
- **GET /api/users** - รายการ users
- **GET /api/issues** - ปัญหาที่พบบ่อย พร้อมสถิติ
- **GET /api/ratings** - การกระจายตัวของ ratings

## 📁 Project Structure

```
line-it-support-bot/
├── src/
│   ├── app.js                 # Main Express application
│   ├── config/
│   │   └── database.js        # MongoDB connection setup
│   ├── models/
│   │   ├── User.js            # User schema
│   │   └── Conversation.js    # Conversation schema with messages
│   ├── services/
│   │   ├── gemini.js          # Gemini AI integration
│   │   └── line.js            # LINE messaging logic
│   └── routes/
│       └── api.js             # API endpoints
│
├── examples/
│   ├── seed.js                # Seed data for testing
│   └── test-api.js            # API testing script
│
├── docs/
│   ├── ARCHITECTURE.md        # System architecture diagram
│   └── QUICK_START.md         # Quick start guide
│
├── package.json               # Dependencies
├── .env.example               # Environment variables template
├── .gitignore                 # Git ignore rules
└── README.md                  # Full documentation
```

## 🛠 Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Bun.js |
| Framework | Express.js |
| Database | MongoDB + Mongoose |
| AI Engine | Google Gemini 1.5 Flash |
| Messaging | LINE Messaging API |
| Language | JavaScript (ES Modules) |

## 📊 Database Schema

### Users Collection
```javascript
{
  lineUserId: String (unique),
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
  sessionId: String (unique),
  messages: [{
    role: 'user' | 'assistant' | 'system',
    content: String,
    timestamp: Date
  }],
  issue: String,              // AI-generated summary
  resolved: Boolean,
  rating: Number (1-5),
  feedback: String,
  escalated: Boolean,
  status: 'active' | 'waiting_rating' | 'closed',
  createdAt: Date,
  closedAt: Date
}
```

## 🚀 Getting Started

### Prerequisites
- Bun.js runtime
- MongoDB (local or Docker)
- LINE Messaging API credentials
- Google Gemini API key

### Installation
```bash
cd line-it-support-bot
bun install
cp .env.example .env
# Edit .env with your credentials
bun run dev
```

### Seed Test Data
```bash
bun run examples/seed.js
```

### Test API
```bash
bun run examples/test-api.js
```

## 📝 Environment Variables

```env
LINE_CHANNEL_ACCESS_TOKEN=     # จาก LINE Developers Console
LINE_CHANNEL_SECRET=           # จาก LINE Developers Console
GEMINI_API_KEY=                # จาก Google AI Studio
MONGODB_URI=                   # MongoDB connection string
PORT=3000                      # Server port
IT_SUPPORT_LINE_URL=           # LINE URL ของทีม IT จริง
```

## 🔌 API Endpoints Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/webhook` | POST | LINE webhook (receives messages) |
| `/api/stats` | GET | Overall statistics |
| `/api/conversations` | GET | List conversations (paginated) |
| `/api/conversations/:id` | GET | Get conversation detail |
| `/api/users` | GET | List users (paginated) |
| `/api/issues` | GET | Top issues with resolution stats |
| `/api/ratings` | GET | Rating distribution |

## 🎭 User Flows

### 1. First Time User
```
Send message → Register (name, employee ID, department) → Start chatting
```

### 2. Regular Conversation
```
Ask question → AI responds → Continue chat → Solved? → Rate 1-5 stars
```

### 3. Escalation
```
Ask question → AI tries to help → Not solved → Escalate to IT team
```

## 📈 Key Metrics Tracked

- Total users registered
- Total conversations
- Resolution rate (%)
- Average rating (1-5)
- Top issues by frequency
- Escalation rate
- Rating distribution

## 🔐 Security Features

- Environment variables for sensitive data
- MongoDB connection with authentication support
- LINE webhook signature verification (via @line/bot-sdk middleware)
- Input validation in user registration

## 🎨 Customization Points

1. **AI Prompt** - Edit `SYSTEM_PROMPT` in `src/services/gemini.js`
2. **Rating Threshold** - Change when to ask for rating in `src/services/line.js`
3. **Escalation Logic** - Modify escalation conditions in `src/services/line.js`
4. **API Filters** - Add more query params in `src/routes/api.js`

## 📚 Documentation Files

- **README.md** - Complete usage guide
- **QUICK_START.md** - 5-minute setup guide
- **ARCHITECTURE.md** - System design and flow diagrams

## 🧪 Testing

### Manual Testing
1. Use seed script to generate test data
2. Use test-api.js to verify endpoints
3. Use ngrok + real LINE account for E2E testing

### Example Test Data
- 5 sample users
- 5 sample conversations
- Various scenarios (resolved, escalated, rated)

## 🚢 Deployment Considerations

### Production Checklist
- [ ] Use production MongoDB (Atlas, etc.)
- [ ] Set up HTTPS/SSL for webhook
- [ ] Configure proper error logging
- [ ] Set up monitoring (uptime, errors)
- [ ] Use PM2 or similar for process management
- [ ] Set up backup strategy for MongoDB
- [ ] Configure rate limiting
- [ ] Set up alerts for escalations

### Recommended Services
- **Hosting**: Railway, Fly.io, Render, DigitalOcean
- **MongoDB**: MongoDB Atlas
- **Monitoring**: Sentry, LogRocket
- **Process Manager**: PM2

## 🐛 Known Limitations

1. No authentication on API endpoints (add JWT if needed)
2. No rate limiting (add express-rate-limit if needed)
3. Conversation history stored forever (consider TTL/cleanup)
4. Single language support (Thai - can extend to multi-language)

## 🔮 Future Enhancements

- [ ] Admin dashboard (React/Next.js)
- [ ] Rich menus in LINE
- [ ] File upload support (screenshots)
- [ ] Multi-language support
- [ ] Integration with ticketing system (Jira, Zendesk)
- [ ] Voice message support
- [ ] Scheduled messages/reminders
- [ ] Export conversation history to PDF

## 📞 Support

For issues or questions:
1. Check README.md Troubleshooting section
2. Review logs in console
3. Open GitHub issue

## 📄 License

MIT License - Free to use and modify

---

**Created with** ❤️ **using Bun.js, Express, MongoDB, and Google Gemini**

Last Updated: March 2026
