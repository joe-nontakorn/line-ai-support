# 🚀 Quick Start Guide

เริ่มต้นใช้งาน LINE IT Support Bot ภายใน 5 นาที!

## ขั้นตอนที่ 1: ติดตั้ง Dependencies

```bash
# ติดตั้ง Bun (ถ้ายังไม่มี)
curl -fsSL https://bun.sh/install | bash

# ติดตั้ง packages
cd line-it-support-bot
bun install
```

## ขั้นตอนที่ 2: ตั้งค่า Environment Variables

```bash
# Copy .env.example
cp .env.example .env

# แก้ไขไฟล์ .env
nano .env
```

ใส่ค่าต่อไปนี้:

```env
# LINE - รับจาก https://developers.line.biz/
LINE_CHANNEL_ACCESS_TOKEN=your_token_here
LINE_CHANNEL_SECRET=your_secret_here

# Gemini - รับจาก https://makersuite.google.com/app/apikey
GEMINI_API_KEY=your_gemini_key_here

# MongoDB
MONGODB_URI=mongodb://localhost:27017/line-it-support

# Server
PORT=3000

# IT Support Contact (แก้เป็นของคุณ)
IT_SUPPORT_LINE_URL=https://line.me/ti/p/your-it-line
```

## ขั้นตอนที่ 3: เริ่ม MongoDB

### วิธีที่ 1: ใช้ Docker (แนะนำ)

```bash
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

### วิธีที่ 2: ติดตั้ง Local

**macOS:**
```bash
brew install mongodb-community
brew services start mongodb-community
```

**Ubuntu:**
```bash
sudo systemctl start mongod
```

## ขั้นตอนที่ 4: Seed ข้อมูลตัวอย่าง (Optional)

```bash
bun run examples/seed.js
```

จะได้ข้อมูล:
- 5 users
- 5 conversations
- ข้อมูล ratings และ issues

## ขั้นตอนที่ 5: รัน Server

```bash
# Development mode (auto-reload)
bun run dev

# หรือ Production mode
bun start
```

คุณจะเห็น:
```
🚀 Server is running on port 3000
📍 Webhook URL: http://localhost:3000/webhook
📊 API URL: http://localhost:3000/api
```

## ขั้นตอนที่ 6: ทดสอบ API

เปิด terminal ใหม่:

```bash
bun run examples/test-api.js
```

หรือใช้ curl:

```bash
# Test health check
curl http://localhost:3000/

# Test stats API
curl http://localhost:3000/api/stats | jq

# Test conversations API
curl http://localhost:3000/api/conversations | jq

# Test users API
curl http://localhost:3000/api/users | jq

# Test issues API
curl http://localhost:3000/api/issues | jq

# Test ratings API
curl http://localhost:3000/api/ratings | jq
```

## ขั้นตอนที่ 7: Setup LINE Webhook (สำหรับใช้งานจริง)

### 7.1 Expose Local Server (ใช้ ngrok)

```bash
# ติดตั้ง ngrok
brew install ngrok  # macOS
# หรือ download จาก https://ngrok.com/

# Run ngrok
ngrok http 3000
```

คุณจะได้ URL แบบ: `https://xxxx-xx-xx-xxx-xx.ngrok-free.app`

### 7.2 ตั้งค่า LINE Developers Console

1. ไปที่ https://developers.line.biz/console/
2. เลือก Provider และ Channel ของคุณ
3. ไปที่ **Messaging API** tab
4. ตั้งค่า **Webhook URL**: `https://your-ngrok-url.ngrok-free.app/webhook`
5. **Enable** Webhook
6. ปิด **Auto-reply messages**

### 7.3 ทดสอบ

1. เพิ่ม LINE Bot เป็นเพื่อน (สแกน QR Code จาก LINE Developers Console)
2. ส่งข้อความอะไรก็ได้
3. Bot จะขอให้ลงทะเบียน (ชื่อ, รหัสพนักงาน, แผนก)
4. เริ่มสนทนาได้เลย!

## 🎯 ตัวอย่างการใช้งาน

### ลงทะเบียนครั้งแรก
```
User: สวัสดี
Bot:  ยินดีต้อนรับสู่ระบบ IT Support 👋
      กรุณากรอกข้อมูลเพื่อเริ่มใช้งาน
      ชื่อ-นามสกุล:

User: สมชาย ใจดี
Bot:  รหัสพนักงาน:

User: EMP001
Bot:  แผนก/ฝ่าย:

User: IT
Bot:  ลงทะเบียนสำเร็จ! ✅
      ชื่อ: สมชาย ใจดี
      รหัสพนักงาน: EMP001
      แผนก: IT
      
      พิมพ์คำถามหรือปัญหาที่ต้องการความช่วยเหลือได้เลยครับ
```

### ถามคำถาม
```
User: ลืมรหัสผ่าน Windows
Bot:  [AI ตอบพร้อมวิธีแก้ปัญหา step-by-step]

User: ลองแล้วไม่ได้ครับ
Bot:  [AI แนะนำเพิ่มเติม]
      ---
      แก้ปัญหาได้แล้วหรือยังครับ?
      [Quick Reply: ✅แก้ได้แล้ว | ❌ยังไม่ได้ | 👤ติดต่อเจ้าหน้าที่]
```

### ให้คะแนน
```
User: แก้ได้แล้ว
Bot:  ยินดีด้วยครับ! 🎉
      กรุณาให้คะแนนความพึงพอใจ:
      [Quick Reply: ⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐]

User: 5
Bot:  ขอบคุณสำหรับการให้คะแนน! ⭐⭐⭐⭐⭐
      หากมีปัญหาอื่นๆ สามารถสอบถามได้ตลอดเวลาครับ 😊
```

### Escalate
```
User: ติดต่อเจ้าหน้าที่
Bot:  เข้าใจครับ ให้ผมส่งต่อไปยังเจ้าหน้าที่ IT Support
      
      กรุณาติดต่อที่:
      https://line.me/ti/p/xxx
      
      หรือสามารถโทร: 02-XXX-XXXX
      อีเมล: [email protected]
```

## 🔧 Troubleshooting

### MongoDB Connection Failed
```bash
# ตรวจสอบว่า MongoDB รันอยู่หรือไม่
mongosh  # ถ้าเข้าได้แสดงว่าทำงาน

# หรือ
docker ps | grep mongodb
```

### LINE Webhook Error
- ตรวจสอบ ngrok ยังรันอยู่หรือไม่
- ตรวจสอบ URL ใน LINE Console ถูกต้องหรือไม่
- ดู logs ว่ามี error อะไร

### Gemini API Error
- ตรวจสอบ API Key ถูกต้องหรือไม่
- ตรวจสอบ Quota/Billing
- ดู error message ใน console

## 📚 เอกสารเพิ่มเติม

- [README.md](../README.md) - คู่มือฉบับเต็ม
- [ARCHITECTURE.md](../docs/ARCHITECTURE.md) - สถาปัตยกรรมระบบ
- [API Documentation](#) - รายละเอียด API endpoints

## 🆘 ต้องการความช่วยเหลือ?

1. ดู [README.md](../README.md) ส่วน Troubleshooting
2. ตรวจสอบ logs ใน console
3. เปิด Issue ใน GitHub

Happy coding! 🎉
