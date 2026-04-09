#!/usr/bin/env bun

/**
 * Seed Script - สร้างข้อมูลตัวอย่างสำหรับทดสอบ
 * วิธีใช้: bun run examples/seed.js
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Conversation from '../src/models/Conversation.js';
import { v4 as uuidv4 } from 'uuid';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/line-it-support';

// Sample data
const sampleUsers = [
  {
    lineUserId: 'U1234567890abcdef1234567890abcdef',
    name: 'สมชาย ใจดี',
    employeeId: 'EMP001',
    department: 'IT'
  },
  {
    lineUserId: 'U2234567890abcdef1234567890abcdef',
    name: 'สมหญิง รักงาน',
    employeeId: 'EMP002',
    department: 'HR'
  },
  {
    lineUserId: 'U3234567890abcdef1234567890abcdef',
    name: 'วิทยา เก่งงาน',
    employeeId: 'EMP003',
    department: 'Finance'
  },
  {
    lineUserId: 'U4234567890abcdef1234567890abcdef',
    name: 'ณัฐพล มั่นคง',
    employeeId: 'EMP004',
    department: 'Marketing'
  },
  {
    lineUserId: 'U5234567890abcdef1234567890abcdef',
    name: 'ปิยะ สร้างสรรค์',
    employeeId: 'EMP005',
    department: 'Sales'
  }
];

const sampleConversations = [
  {
    lineUserId: 'U1234567890abcdef1234567890abcdef',
    messages: [
      { role: 'user', content: 'ลืมรหัสผ่าน Windows ครับ' },
      { role: 'assistant', content: 'เข้าใจครับ สามารถรีเซ็ตรหัสผ่านได้ดังนี้:\n\n1. กด Ctrl+Alt+Delete\n2. เลือก "Change a password"\n3. ใส่รหัสเดิม (ถ้าจำได้) หรือเลือก "Reset password"\n4. ตั้งรหัสใหม่\n\nถ้าไม่สามารถทำได้ กรุณาติดต่อ IT Support เพื่อยืนยันตัวตนและรีเซ็ตให้ครับ' },
      { role: 'user', content: 'ลองแล้วไม่ได้ครับ' },
      { role: 'assistant', content: 'งั้นคงต้องให้ทีม IT ช่วยรีเซ็ตให้ครับ เพราะต้องยืนยันตัวตนก่อน\n\nให้ผมติดต่อทีม IT ให้ไหมครับ?' }
    ],
    issue: 'ลืมรหัสผ่าน Windows',
    resolved: false,
    escalated: true,
    status: 'closed'
  },
  {
    lineUserId: 'U2234567890abcdef1234567890abcdef',
    messages: [
      { role: 'user', content: 'เครื่องพิมพ์ไม่ทำงานค่ะ' },
      { role: 'assistant', content: 'ช่วยตรวจสอบดังนี้นะคะ:\n\n1. เช็คว่าเครื่องพิมพ์เปิดอยู่หรือไม่\n2. ดูว่ามีกระดาษในถาดหรือไม่\n3. ตรวจสอบสายเคเบิล/Wi-Fi\n4. ลองพิมพ์ test page จาก Settings\n\nเป็นอย่างไรบ้างคะ?' },
      { role: 'user', content: 'ลองแล้ว พิมพ์ test page ออกค่ะ' },
      { role: 'assistant', content: 'ดีมากเลยค่ะ แสดงว่าเครื่องพิมพ์ใช้งานได้ปกติ\n\nถ้ายังพิมพ์จากโปรแกรมอื่นไม่ได้ ลอง:\n1. Restart โปรแกรมที่จะพิมพ์\n2. ตรวจสอบว่าเลือก printer ถูกต้องหรือไม่\n3. Restart เครื่องคอมพิวเตอร์' },
      { role: 'user', content: 'ได้แล้วค่ะ ขอบคุณมากเลย' }
    ],
    issue: 'เครื่องพิมพ์ไม่ทำงาน',
    resolved: true,
    rating: 5,
    status: 'closed'
  },
  {
    lineUserId: 'U3234567890abcdef1234567890abcdef',
    messages: [
      { role: 'user', content: 'อินเทอร์เน็ตช้ามากครับ' },
      { role: 'assistant', content: 'มาลองแก้ปัญหากันครับ:\n\n1. Speedtest ดูว่าความเร็วเท่าไหร่\n2. ปิด-เปิด Wi-Fi ใหม่\n3. ลอง restart router\n4. ตรวจสอบว่ามีโปรแกรมอื่นใช้ bandwidth มากไหม\n\nลองดูแล้วเป็นอย่างไรครับ?' },
      { role: 'user', content: 'Speedtest แล้วได้แค่ 5 Mbps ครับ ปกติได้ 100' },
      { role: 'assistant', content: 'อ้อ ช้ามากเลยครับ ลอง:\n\n1. Restart router รอ 30 วินาที แล้วเปิดใหม่\n2. เช็คว่าใช้ LAN cable หรือ Wi-Fi\n3. ถ้าเป็น Wi-Fi ลองเข้าใกล้ router ดู\n\nถ้ายังช้าอยู่ อาจเป็นปัญหาที่สัญญาณอินเทอร์เน็ต ต้องติดต่อผู้ให้บริการครับ' },
      { role: 'user', content: 'Restart router แล้วดีขึ้นครับ' }
    ],
    issue: 'อินเทอร์เน็ตช้า',
    resolved: true,
    rating: 4,
    status: 'closed'
  },
  {
    lineUserId: 'U4234567890abcdef1234567890abcdef',
    messages: [
      { role: 'user', content: 'Excel เปิดไฟล์ไม่ได้ค่ะ' },
      { role: 'assistant', content: 'ขออนุญาตสอบถามเพิ่มนะคะ:\n\n1. ขึ้น error message อะไรไหม?\n2. เป็นไฟล์เก่าหรือไฟล์ใหม่?\n3. ลองเปิดไฟล์อื่นได้ไหม?' },
      { role: 'user', content: 'ขึ้นว่า file corrupted ค่ะ' },
      { role: 'assistant', content: 'เข้าใจค่ะ ไฟล์อาจเสียหาย ลองวิธีนี้:\n\n1. เปิด Excel → File → Open\n2. เลือกไฟล์ แต่อย่าเปิดเลย\n3. คลิกลูกศรข้าง "Open" → เลือก "Open and Repair"\n\nถ้ายังไม่ได้ อาจต้องใช้ backup หรือให้ IT ช่วยกู้ไฟล์ค่ะ' }
    ],
    issue: 'Excel เปิดไฟล์ไม่ได้ file corrupted',
    resolved: false,
    rating: 3,
    status: 'closed'
  },
  {
    lineUserId: 'U5234567890abcdef1234567890abcdef',
    messages: [
      { role: 'user', content: 'VPN เชื่อมต่อไม่ได้ครับ' },
      { role: 'assistant', content: 'ช่วยตรวจสอบดังนี้ครับ:\n\n1. เช็ค username/password ถูกต้องไหม\n2. ลองเชื่อมต่อ Wi-Fi/4G ก่อน แล้วค่อยเปิด VPN\n3. ลอง restart VPN app\n4. Update VPN app ให้เป็นเวอร์ชั่นล่าสุด\n\nลองแล้วได้ไหมครับ?' },
      { role: 'user', content: 'ได้แล้วครับ restart app แล้วใช้งานได้' }
    ],
    issue: 'VPN เชื่อมต่อไม่ได้',
    resolved: true,
    rating: 5,
    status: 'closed'
  }
];

async function seed() {
  try {
    console.log('🌱 Starting seed process...\n');

    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✓ Connected to MongoDB\n');

    // Clear existing data
    console.log('🗑️  Clearing existing data...');
    await User.deleteMany({});
    await Conversation.deleteMany({});
    console.log('✓ Data cleared\n');

    // Insert users
    console.log('👥 Creating users...');
    const users = await User.insertMany(sampleUsers);
    console.log(`✓ Created ${users.length} users\n`);

    // Insert conversations
    console.log('💬 Creating conversations...');
    const conversations = sampleConversations.map(conv => ({
      ...conv,
      sessionId: uuidv4(),
      createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000), // Random date in last 7 days
      closedAt: conv.status === 'closed' ? new Date() : null
    }));

    const convs = await Conversation.insertMany(conversations);
    console.log(`✓ Created ${convs.length} conversations\n`);

    // Summary
    console.log('📊 Summary:');
    console.log(`   Users: ${users.length}`);
    console.log(`   Conversations: ${convs.length}`);
    console.log(`   Resolved: ${convs.filter(c => c.resolved).length}`);
    console.log(`   Escalated: ${convs.filter(c => c.escalated).length}`);
    console.log(`   With Rating: ${convs.filter(c => c.rating).length}`);
    
    const avgRating = convs
      .filter(c => c.rating)
      .reduce((sum, c) => sum + c.rating, 0) / convs.filter(c => c.rating).length;
    console.log(`   Avg Rating: ${avgRating.toFixed(2)} ⭐\n`);

    console.log('✅ Seed completed successfully!\n');
    console.log('💡 Now you can:');
    console.log('   1. Start the server: bun run dev');
    console.log('   2. Test the API: bun run examples/test-api.js\n');

  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

// Run seed
seed();
