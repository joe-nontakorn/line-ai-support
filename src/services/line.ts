import User from '../models/User.js';
import Conversation, { IConversation } from '../models/Conversation.js';
import geminiService from './gemini.js';
import { v4 as uuidv4 } from 'uuid';
import { Client, MessageEvent, TextEventMessage, ImageEventMessage, FileEventMessage } from '@line/bot-sdk';

// เก็บสถานะการลงทะเบียนของ user ชั่วคราว
interface RegistrationState {
  step: number;
  name?: string;
  employeeId?: string;
  department?: string;
}
const registrationStates = new Map<string, RegistrationState>();

export class LineService {
  private client: Client;

  constructor(lineClient: Client) {
    this.client = lineClient;
  }

  private async getActiveConversation(userId: string): Promise<any> {
    const conversation = await Conversation.findOne({
      lineUserId: userId,
      status: 'active'
    }).sort({ createdAt: -1 });

    if (conversation) {
      // ตรวจสอบว่าข้ามวันหรือไม่
      const today = new Date().toDateString();
      const createdDate = new Date(conversation.createdAt).toDateString();
      if (today !== createdDate) {
        conversation.status = 'closed';
        conversation.closedAt = new Date();
        await conversation.save();
        return null; // หมดอายุวันก่อน ให้เริ่มใหม่
      }
      return conversation;
    }
    return null;
  }

  async handleMessage(event: MessageEvent): Promise<any> {
    const replyToken = event.replyToken;
    const source = event.source;
    
    // Type narrowing for source.userId
    const userId = source.type === 'user' ? source.userId : (source.type === 'group' ? source.userId : undefined);
    
    if (!userId) {
      console.warn('No userId found in event source');
      return;
    }

    const message = event.message;

    try {
      // ตรวจสอบว่า user ลงทะเบียนแล้วหรือยัง
      let user = await User.findOne({ lineUserId: userId });

      if (!user) {
        // ขณะลงทะเบียนรับเฉพาะ text เท่านั้น
        if (message.type !== 'text') {
          return await this.replyMessage(replyToken, 'กรุณาลงทะเบียนด้วยข้อความก่อนนะครับ');
        }
        return await this.handleRegistration(replyToken, userId, (message as TextEventMessage).text);
      }

      // ตรวจสอบว่า user กำลังให้ rating อยู่หรือไม่
      const waitingRatingConv = await Conversation.findOne({
        lineUserId: userId,
        status: 'waiting_rating'
      });

      if (waitingRatingConv) {
        if (message.type !== 'text') {
          return await this.replyMessage(replyToken, 'กรุณาให้คะแนนเป็นตัวเลข 1-5 ครับ');
        }
        return await this.handleRating(replyToken, userId, (message as TextEventMessage).text, waitingRatingConv);
      }

      // ตรวจสอบว่า user กำลังให้รายละเอียดเพื่อติดต่อเจ้าหน้าที่หรือไม่
      const waitingEscalationConv = await Conversation.findOne({
        lineUserId: userId,
        status: 'waiting_escalation_issue'
      });

      if (waitingEscalationConv) {
        if (message.type !== 'text') {
          return await this.replyMessage(replyToken, 'กรุณาระบุปัญหาเป็นข้อความครับ');
        }
        return await this.escalateToSupport(replyToken, userId, (message as TextEventMessage).text, waitingEscalationConv);
      }

      // จัดการ message แต่ละประเภท
      switch (message.type) {
        case 'text':
          return await this.handleTextMessage(replyToken, userId, (message as TextEventMessage).text);

        case 'image':
          return await this.handleImageMessage(replyToken, userId, message as ImageEventMessage);

        case 'file':
          return await this.handleFileMessage(replyToken, userId, message as FileEventMessage);

        case 'sticker':
          return await this.replyMessage(replyToken, 'สวัสดีครับ หากต้องการให้ดูแลเรื่อง IT Support รบกวนพิมพ์ /start เพื่อเริ่มสนทนาใหม่ได้เลยครับ 😊');

        default:
          return await this.replyMessage(replyToken, 'ขออภัยครับ รองรับเฉพาะข้อความ, รูปภาพ และไฟล์ PDF เท่านั้น');
      }
    } catch (error) {
      console.error('Error handling message:', error);
      await this.replyMessage(replyToken, 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
    }
  }

  async handleTextMessage(replyToken: string, userId: string, text: string): Promise<any> {
    // จัดการคำสั่งพิเศษ
    if (text === '/start' || text === 'เริ่มสนทนาใหม่') {
      return await this.startNewConversation(replyToken, userId);
    }

    const greetingKeywords = ['hi', 'hello', 'สวัสดี', 'สวัสดีครับ', 'สวัสดีค่ะ', 'ดีจ้า', 'ดีครับ', 'ดีค่ะ', 'ทัก', 'ดีค้าบ', 'สวัสดีค้าบ', 'หวัดดี'];
    if (greetingKeywords.includes(text.toLowerCase().trim())) {
      return await this.replyMessage(replyToken, 'สวัสดีครับ หากต้องการให้ดูแลเรื่อง IT Support รบกวนพิมพ์ /start เพื่อเริ่มสนทนาใหม่ได้เลยครับ 😊');
    }

    if (text === '/help' || text === 'ช่วยเหลือ') {
      return await this.showHelp(replyToken);
    }

    // ดักจับ Quick Reply รีแอคชันเมื่อถามว่า "แก้ปัญหาได้แล้วหรือยังครับ?"
    if (text === 'แก้ได้แล้ว') {
      const activeConv = await Conversation.findOne({ lineUserId: userId, status: 'active' }).sort({ createdAt: -1 });
      if (activeConv) {
        return await this.handleRating(replyToken, userId, text, activeConv);
      }
    }

    if (text === 'ยังแก้ไม่ได้') {
      return await this.escalateToSupport(replyToken, userId, text);
    }

    const escalateKeywords = [
      'ติดต่อเจ้าหน้าที่', 'escalate', 'ติดต่อit', 'ติดต่อ it',
      'เรียกit', 'เรียก it', 'คุยกับคน', 'คุยกับเจ้าหน้าที่',
      'แจ้งit', 'แจ้ง it', 'เรียกแอดมิน', 'เรียก admin'
    ];
    if (escalateKeywords.some(keyword => text.toLowerCase().includes(keyword))) {
      return await this.promptForEscalationIssue(replyToken, userId);
    }

    // จัดการการสนทนาปกติ
    return await this.handleConversation(replyToken, userId, text);
  }

  async handleImageMessage(replyToken: string, userId: string, message: ImageEventMessage): Promise<any> {
    try {
      // ดาวน์โหลดรูปภาพจาก LINE
      const imageBuffer = await this.client.getMessageContent(message.id);
      const chunks: Buffer[] = [];

      for await (const chunk of imageBuffer as any) {
        chunks.push(chunk as Buffer);
      }

      const imageData = Buffer.concat(chunks);
      const base64Image = imageData.toString('base64');

      // เปิด Loading Animation (20 วินาที) ก่อนส่งรูปไปให้ Gemini วิเคราะห์
      await this.showLoadingAnimation(userId, 20);
      const analysisResult = await geminiService.analyzeImage(base64Image);

      // บันทึกลง conversation
      let conversation = await this.getActiveConversation(userId);

      if (!conversation) {
        conversation = await Conversation.create({
          lineUserId: userId,
          sessionId: uuidv4(),
          messages: [],
          status: 'active'
        });
      }

      // เพิ่มข้อความของ user (บันทึกว่าส่งรูปมา)
      conversation.messages.push({
        role: 'user',
        content: '[ส่งรูปภาพ] ' + (analysisResult.description || 'รูปภาพที่เกี่ยวข้องกับปัญหา'),
        timestamp: new Date()
      });

      // เพิ่มคำตอบของ AI
      conversation.messages.push({
        role: 'assistant',
        content: analysisResult.response,
        timestamp: new Date()
      });

      await conversation.save();

      return await this.replyMessage(replyToken, analysisResult.response);
    } catch (error) {
      console.error('Error handling image:', error);
      return await this.replyMessage(replyToken, 'ไม่สามารถประมวลผลรูปภาพได้ กรุณาลองใหม่อีกครั้ง');
    }
  }

  async handleFileMessage(replyToken: string, userId: string, message: FileEventMessage): Promise<any> {
    try {
      // ตรวจสอบว่าเป็น PDF หรือไม่
      const fileName = message.fileName || '';
      if (!fileName.toLowerCase().endsWith('.pdf')) {
        return await this.replyMessage(replyToken, 'รองรับเฉพาะไฟล์ PDF เท่านั้นครับ');
      }

      // ดาวน์โหลดไฟล์จาก LINE
      const fileBuffer = await this.client.getMessageContent(message.id);
      const chunks: Buffer[] = [];

      for await (const chunk of fileBuffer as any) {
        chunks.push(chunk as Buffer);
      }

      const fileData = Buffer.concat(chunks);
      const base64File = fileData.toString('base64');

      // เปิด Loading Animation (20 วินาที) ก่อนส่งไฟล์ PDF ไปให้ Gemini วิเคราะห์
      await this.showLoadingAnimation(userId, 20);
      const analysisResult = await geminiService.analyzePDF(base64File, fileName);

      // บันทึกลง conversation
      let conversation = await this.getActiveConversation(userId);

      if (!conversation) {
        conversation = await Conversation.create({
          lineUserId: userId,
          sessionId: uuidv4(),
          messages: [],
          status: 'active'
        });
      }

      // เพิ่มข้อความของ user
      conversation.messages.push({
        role: 'user',
        content: `[ส่งไฟล์ PDF] ${fileName}`,
        timestamp: new Date()
      });

      // เพิ่มคำตอบของ AI
      conversation.messages.push({
        role: 'assistant',
        content: analysisResult.response,
        timestamp: new Date()
      });

      await conversation.save();

      return await this.replyMessage(replyToken, analysisResult.response);
    } catch (error) {
      console.error('Error handling file:', error);
      return await this.replyMessage(replyToken, 'ไม่สามารถประมวลผลไฟล์ได้ กรุณาลองใหม่อีกครั้ง');
    }
  }

  async handleRegistration(replyToken: string, userId: string, text: string): Promise<any> {
    const state = registrationStates.get(userId) || { step: 0 };

    if (state.step === 0) {
      registrationStates.set(userId, { step: 1 });
      return await this.replyMessage(replyToken,
        'ยินดีต้อนรับสู่ระบบ IT Support 👋\n\nกรุณากรอกข้อมูลเพื่อเริ่มใช้งาน\nคุณสามารถพิมพ์รวดเดียว (คั่นด้วยเว้นวรรค หรือขึ้นบรรทัดใหม่) ได้เลยครับ\n\nตัวอย่าง:\nสมชาย ใจดี\n12345\nไอที\n\nหรือจะค่อยๆ พิมพ์ทีละอย่างก็ได้ครับ\n\nเริ่มจากใส่ ชื่อ-นามสกุล:'
      );
    }

    if (state.step === 1) {
      // ตรวจสอบว่าพิมพ์มาทีเดียวครบรึเปล่า (ดูจากการขึ้นบรรทัดใหม่)
      let parts = text.split('\n').map(p => p.trim()).filter(p => p.length > 0);

      // ถ้าไม่มีการเว้นบรรทัด ลองดูว่าเว้นวรรคมาหรือไม่ (ถ้ามีอย่างน้อย 3 ส่วน คือ ชื่อ สกุล รหัส แผนก)
      if (parts.length === 1) {
        const spaceParts = text.split(/\s+/).filter(p => p.length > 0);
        if (spaceParts.length >= 4) {
          // สมมติ 2 คำสุดท้ายคือ รหัสพนักงาน และ แผนก ส่วนที่เหลือคือชื่อ-สกุล
          const dept = spaceParts.pop() || '';
          const empId = spaceParts.pop() || '';
          const name = spaceParts.join(' ');
          parts = [name, empId, dept];
        } else if (spaceParts.length === 3) {
          // ถ้ามี 3 คำ สมมติเป็น ชื่อ รหัส แผนก
          const dept = spaceParts.pop() || '';
          const empId = spaceParts.pop() || '';
          const name = spaceParts[0];
          parts = [name, empId, dept];
        }
      }

      if (parts.length >= 3) {
        // ลงทะเบียนสำเร็จในครั้งเดียว
        state.name = parts[0];
        state.employeeId = parts[1];
        state.department = parts.slice(2).join(' ');

        await User.create({
          lineUserId: userId,
          name: state.name,
          employeeId: state.employeeId,
          department: state.department
        });

        registrationStates.delete(userId);

        return await this.replyMessage(replyToken,
          `ลงทะเบียนสำเร็จแบบรวดรัด! ✅\n\nชื่อ: ${state.name}\nรหัสพนักงาน: ${state.employeeId}\nแผนก: ${state.department}\n\nพิมพ์คำถามหรือปัญหาที่ต้องการความช่วยเหลือได้เลยครับ 😊`
        );
      }

      // ถ้าไม่ได้พิมพ์มาครบ ให้เข้าสู่ Step ต่อไปปกติ
      state.name = text;
      state.step = 2;
      registrationStates.set(userId, state);
      return await this.replyMessage(replyToken, 'รหัสพนักงาน:');
    }

    if (state.step === 2) {
      state.employeeId = text;
      state.step = 3;
      registrationStates.set(userId, state);
      return await this.replyMessage(replyToken, 'แผนก/ฝ่าย:');
    }

    if (state.step === 3) {
      state.department = text;

      // บันทึกข้อมูล user
      await User.create({
        lineUserId: userId,
        name: state.name,
        employeeId: state.employeeId,
        department: state.department
      });

      registrationStates.delete(userId);

      return await this.replyMessage(replyToken,
        `ลงทะเบียนสำเร็จ! ✅\n\nชื่อ: ${state.name}\nรหัสพนักงาน: ${state.employeeId}\nแผนก: ${state.department}\n\nพิมพ์คำถามหรือปัญหาที่ต้องการความช่วยเหลือได้เลยครับ 😊\n\nหรือพิมพ์ /help เพื่อดูคำแนะนำ`
      );
    }
  }

  async handleConversation(replyToken: string, userId: string, text: string): Promise<any> {
    // หา conversation ที่กำลัง active อยู่ (และไม่ข้ามวัน)
    let conversation = await this.getActiveConversation(userId);

    // ถ้าไม่มี สร้างใหม่
    if (!conversation) {
      conversation = await Conversation.create({
        lineUserId: userId,
        sessionId: uuidv4(),
        messages: [],
        status: 'active'
      });
    }

    // เพิ่มข้อความของ user
    conversation.messages.push({
      role: 'user',
      content: text,
      timestamp: new Date()
    });

    await this.showLoadingAnimation(userId, 20);
    const aiResponseRaw = await geminiService.chat(conversation.messages);
    
    // แยกเนื้อหาและหมวดย่อยของคำตอบ
    const { content: aiResponse, type: responseType } = geminiService.parseResponse(aiResponseRaw);

    // เก็บประวัติการสนทนา
    conversation.messages.push({
      role: 'assistant',
      content: aiResponse,
      timestamp: new Date()
    });

    // ตรวจสอบประเภทคำถาม
    if (responseType === 'OUT_OF_SCOPE') {
      conversation.nonItCount = (conversation.nonItCount || 0) + 1;
      
      // ถ้าถามนอกเรื่องครบ 3 ครั้ง
      if (conversation.nonItCount >= 3) {
        await conversation.save();
        return await this.replyMessage(
          replyToken, 
          '⚠️ คำเตือน: ระบบตรวจพบว่าคุณถามข้อมูลที่ไม่เกี่ยวข้องกับ IT Support ครบจำนวนครั้งที่กำหนดแล้ว\n\nกรุณาสอบถามเฉพาะปัญหาที่เกี่ยวกับ IT (เช่น คอมพิวเตอร์เสีย, โปรแกรมใช้งานไม่ได้) เท่านั้นครับ'
        );
      }

      await conversation.save();
      return await this.replyMessage(replyToken, aiResponse);
    }

    // ถ้ากลับมาถามเรื่อง IT ให้ Reset ตัวนับคำถามนอกเรื่อง
    conversation.nonItCount = 0;
    await conversation.save();

    // ถ้าเป็นแค่การให้ข้อมูล (ไม่ใช่การแก้ปัญหา) ก็ไม่ต้องถามว่าแก้ได้หรือยัง
    if (responseType === 'IT_INFO') {
      return await this.replyMessage(replyToken, aiResponse);
    }

    // ถามว่าแก้ปัญหาได้หรือยัง (เฉพาะคำถามที่เป็น IT_PROBLEM)
    return await this.replyMessageWithQuickReply(
      replyToken,
      aiResponse + '\n\n---\nแก้ปัญหาได้แล้วหรือยังครับ?',
      [
        { label: '✅ แก้ได้แล้ว', text: 'แก้ได้แล้ว' },
        { label: '❌ ยังไม่ได้', text: 'ยังแก้ไม่ได้' },
        { label: '👤 ติดต่อเจ้าหน้าที่', text: 'ติดต่อเจ้าหน้าที่' }
      ]
    );
  }

  async handleRating(replyToken: string, userId: string, text: string, conversation: IConversation): Promise<any> {
    if (text === 'แก้ได้แล้ว') {
      conversation.resolved = true;
      conversation.status = 'waiting_rating';
      await conversation.save();

      return await this.replyMessageWithQuickReply(
        replyToken,
        'ยินดีด้วยครับ! 🎉\n\nกรุณาให้คะแนนความพึงพอใจ:',
        [
          { label: '⭐', text: '1' },
          { label: '⭐⭐', text: '2' },
          { label: '⭐⭐⭐', text: '3' },
          { label: '⭐⭐⭐⭐', text: '4' },
          { label: '⭐⭐⭐⭐⭐', text: '5' }
        ]
      );
    }

    if (text === 'ยังแก้ไม่ได้') {
      return await this.escalateToSupport(replyToken, userId);
    }

    // บันทึก rating
    const rating = parseInt(text);
    if (rating >= 1 && rating <= 5) {
      conversation.rating = rating;

      // วิเคราะห์และสรุปปัญหา
      conversation.issue = await geminiService.analyzeIssue(conversation.messages);
      conversation.status = 'closed';
      conversation.closedAt = new Date();
      await conversation.save();

      return await this.replyMessage(
        replyToken,
        `ขอบคุณสำหรับการให้คะแนน! ${'⭐'.repeat(rating)}\n\nหากมีปัญหาอื่นๆ สามารถสอบถามได้ตลอดเวลาครับ 😊\n\nพิมพ์ /start เพื่อเริ่มสนทนาใหม่`
      );
    }

    return await this.replyMessage(replyToken, 'กรุณาเลือกคะแนน 1-5 ดาว');
  }

  async escalateToSupport(replyToken: string, userId: string, userText?: string, existingConv?: IConversation): Promise<any> {
    // หาผู้ใช้งานอิงตาม userId
    const user = await User.findOne({ lineUserId: userId });

    // อัพเดท conversation
    const conversation = existingConv || await Conversation.findOne({
      lineUserId: userId,
      status: { $in: ['active', 'waiting_rating', 'waiting_escalation_issue'] }
    }).sort({ createdAt: -1 });

    let issueSummary = 'ไม่ระบุปัญหา';

    if (conversation) {
      // บันทึกข้อความล่าสุดของ user ลงในประวัติสนทนาก่อนวิเคราะห์
      if (userText) {
        conversation.messages.push({
          role: 'user',
          content: userText,
          timestamp: new Date()
        });
      }

      conversation.escalated = true;
      conversation.issue = await geminiService.analyzeIssue(conversation.messages);
      conversation.status = 'closed';
      conversation.closedAt = new Date();
      await conversation.save();
      issueSummary = conversation.issue;
    } else if (userText) {
      // ไม่มี conversation แต่มีข้อความจาก user → ใช้ข้อความนั้นเป็นสรุปปัญหาเลย
      issueSummary = userText;
    }

    // ส่งข้อความไปที่ Group ของ Admin
    const adminGroupId = process.env.ADMIN_GROUP_ID;
    if (adminGroupId && user) {
      const adminMessage = `🚨 แจ้งเตือนปัญหาใหม่!\n\nผู้แจ้ง: ${user.name}\nรหัสพนักงาน: ${user.employeeId}\nแผนก: ${user.department}\n\nปัญหาที่พบ:\n${issueSummary}`;
      try {
        await this.client.pushMessage(adminGroupId, {
          type: 'text',
          text: adminMessage
        });
      } catch (error) {
        console.error('Error sending message to admin group:', error);
      }
    } else {
      console.warn('ADMIN_GROUP_ID is not set in environment or user not found.');
    }

    return await this.replyMessage(
      replyToken,
      `ระบบได้ส่งเรื่องของ ${user ? 'คุณ ' + user.name : 'คุณ'} ไปยังเจ้าหน้าที่ IT Support เรียบร้อยแล้วครับ\n\nเจ้าหน้าที่จะรีบตรวจสอบและติดต่อกลับโดยเร็วที่สุดครับ 🙏`
    );
  }

  async promptForEscalationIssue(replyToken: string, userId: string): Promise<any> {
    let conversation = await this.getActiveConversation(userId);
    if (!conversation) {
      conversation = await Conversation.create({
        lineUserId: userId,
        sessionId: uuidv4(),
        messages: [],
        status: 'waiting_escalation_issue'
      });
    } else {
      conversation.status = 'waiting_escalation_issue';
      await conversation.save();
    }

    return await this.replyMessage(
      replyToken,
      'ต้องการแจ้งเรื่องอะไรครับ พิมพ์รายละเอียดทิ้งไว้ได้เลยครับ'
    );
  }

  async startNewConversation(replyToken: string, userId: string): Promise<any> {
    // ปิดบทสนทนาเก่าทุกสถานะ
    const openConvs = await Conversation.find({ 
      lineUserId: userId, 
      status: { $in: ['active', 'waiting_rating', 'waiting_escalation_issue'] } 
    });
    for (const conv of openConvs) {
      conv.status = 'closed';
      conv.closedAt = new Date();
      await conv.save();
    }

    return await this.replyMessage(
      replyToken,
      'ยินดีให้บริการครับ\nหากคุณกำลังประสบปัญหาในการใช้งานคอมพิวเตอร์ ระบบเครือข่าย อีเมล หรือโปรแกรมต่างๆ สามารถแจ้งรายละเอียดปัญหาเข้ามาได้เลยครับ ผมพร้อมช่วยตรวจสอบและแนะนำขั้นตอนการแก้ไขเบื้องต้นให้ครับ'
    );
  }

  async showHelp(replyToken: string): Promise<any> {
    const helpText = `📋 คำแนะนำการใช้งาน

🔹 สอบถามปัญหา IT ได้เลย เช่น:
   - ลืมรหัสผ่าน
   - อินเทอร์เน็ตช้า
   - เครื่องพิมพ์ไม่ทำงาน
   - ติดตั้งโปรแกรม

🔹 คำสั่งพิเศษ:
   /start - เริ่มสนทนาใหม่
   /help - แสดงคำแนะนำนี้

🔹 ติดต่อเจ้าหน้าที่:
   พิมพ์ "ติดต่อเจ้าหน้าที่"`;

    return await this.replyMessage(replyToken, helpText);
  }

  async showLoadingAnimation(chatId: string, loadingSeconds: number = 20): Promise<void> {
    try {
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (!token) return;

      await fetch('https://api.line.me/v2/bot/chat/loading/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          chatId,
          loadingSeconds
        })
      });
    } catch (error) {
      console.error('Error showing loading animation:', error);
    }
  }

  async replyMessage(replyToken: string, text: string): Promise<any> {
    return await this.client.replyMessage(replyToken, {
      type: 'text',
      text
    });
  }

  async replyMessageWithQuickReply(replyToken: string, text: string, quickReplyItems: Array<{label: string, text: string}>): Promise<any> {
    return await this.client.replyMessage(replyToken, {
      type: 'text',
      text,
      quickReply: {
        items: quickReplyItems.map(item => ({
          type: 'action',
          action: {
            type: 'message',
            label: item.label,
            text: item.text
          }
        }))
      }
    });
  }
}
