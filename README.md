# LINE IT Support Bot with Gemini AI

Bot LINE ช่วยเหลือด้าน IT Support ด้วย Google Gemini AI พร้อมระบบประเมินความพึงพอใจและเก็บข้อมูลการสนทนา

```
Line API → Cloudflare → Tunnel → Private Server (webhook)
```
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

## RUN cloudflared tunnel

cloudflared tunnel --url http://localhost:3002