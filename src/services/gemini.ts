import { GoogleGenerativeAI } from '@google/generative-ai';
import { IMessage } from '../models/Conversation.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

const SYSTEM_PROMPT = `คุณเป็น AI Assistant สำหรับ IT Support ของบริษัท
บทบาทของคุณคือช่วยแก้ปัญหาด้าน IT ให้กับพนักงาน

สิ่งที่คุณสามารถช่วยได้:
- ปัญหาการใช้งานคอมพิวเตอร์ Windows/Mac
- ปัญหาอินเทอร์เน็ต, Wi-Fi, VPN
- ปัญหา Email, Microsoft Office, Google Workspace
- ปัญหา Printer, Scanner
- การ reset รหัสผ่าน
- ปัญหาซอฟต์แวร์ต่างๆ
- ปัญหาฮาร์ดแวร์เบื้องต้น

วิธีการตอบ:
1. ให้คำแนะนำที่ชัดเจน เป็นขั้นตอน
2. ใช้ภาษาที่เข้าใจง่าย ไม่ซับซ้อนเกินไป
3. ถามคำถามเพิ่มเติมถ้าข้อมูลไม่เพียงพอ
4. ถ้าปัญหาซับซ้อนหรือต้องการการเข้าถึงระบบจริง ให้แนะนำให้ติดต่อ IT Support

ข้อจำกัดและกฎเหล็ก (CRITICAL RULES):
- ห้ามตอบคำถามที่ไม่ได้เกี่ยวข้องกับคอมพิวเตอร์ อินเทอร์เน็ต หรือปัญหาไอที (เช่น ชวนคุยเล่น, ถามเรื่องทั่วไป, สูตรอาหาร, หาพิกัด ฯลฯ) โดยเด็ดขาด
- หากเจอคำถามนอกเรื่อง ให้ตอบกลับเพียงอย่างเดียวว่า "ขออภัยครับ คำถามของคุณอยู่นอกเหนือจากขอบเขตให้บริการของผมที่เป็นผู้ช่วย IT Support ครับ หากมีปัญหาเกี่ยวกับการใช้งานคอมพิวเตอร์ ระบบภายใน หรือโปรแกรมต่างๆ สอบถามเข้ามาได้เลยครับ"
- ไม่ให้ข้อมูลที่อาจเป็นอันตรายต่อความปลอดภัยของระบบ
- ไม่แนะนำให้ดาวน์โหลดซอฟต์แวร์จากแหล่งที่ไม่น่าเชื่อถือ
- ถ้าไม่แน่ใจ ให้แนะนำติดต่อ IT Support

ตอบเป็นภาษาไทย และกระชับ เข้าใจง่าย

สำคัญมาก: ทุกคำตอบต้องปิดท้ายด้วยแท็กหมวดหมู่ดังนี้ (ห้ามลืม):
- [[TYPE:IT_PROBLEM]] หากเป็นการช่วยแก้ปัญหา/อาการเสียด้าน IT
- [[TYPE:IT_INFO]] หากเป็นการตอบคำถามให้ข้อมูลทั่วไปเกี่ยวกับ IT (ไม่ได้แก้ปัญหา)
- [[TYPE:OUT_OF_SCOPE]] หากเป็นคำถามนอกเรื่องที่ไม่เกี่ยวกับ IT`;

export interface GeminiAnalysisResult {
  description: string;
  response: string;
}

export class GeminiService {
  private model: any;
  private visionModel: any;

  constructor() {
    this.model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });
    this.visionModel = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' }); // Gemini 3.1 is multimodal
  }

  private async retryWithBackoff<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      if (retries > 0 && (error.status === 429 || error.message?.includes('429'))) {
        console.log(`Gemini API 429 error, retrying in ${delay}ms... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.retryWithBackoff(fn, retries - 1, delay * 2);
      }
      throw error;
    }
  }

  async chat(conversationHistory: IMessage[]): Promise<string> {
    return this.retryWithBackoff(async () => {
      try {
        // แยก history ออกจากข้อความล่าสุดเพื่อไม่ให้ส่งข้อความเดิมซ้ำในประวัติ
        const history = conversationHistory.slice(0, -1);
        const lastMessage = conversationHistory[conversationHistory.length - 1];

        // แปลง conversation history เป็นรูปแบบที่ Gemini ต้องการ
        const chat = this.model.startChat({
          history: [
            {
              role: 'user',
              parts: [{ text: SYSTEM_PROMPT }]
            },
            {
              role: 'model',
              parts: [{ text: 'เข้าใจครับ ผมพร้อมช่วยเหลือเรื่อง IT Support ด้วยความยินดีครับ' }]
            },
            ...history.map((msg: IMessage) => ({
              role: msg.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: msg.content }]
            }))
          ],
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.7,
          },
        });

        const result = await chat.sendMessage(lastMessage.content);
        const response = result.response;

        return response.text();
      } catch (error) {
        console.error('Gemini API Error:', error);
        throw error;
      }
    });
  }

  // Helper เพื่อดึงเอาหมวดหมู่จาก AI Response และตัดออกเพื่อให้ User ไม่เห็น
  parseResponse(aiResponse: string): { content: string, type: string } {
    const typeMatch = aiResponse.match(/\[\[TYPE:(.*?)\]\]/);
    const type = typeMatch ? typeMatch[1] : 'IT_PROBLEM'; // default เป็นปัญหา
    const content = aiResponse.replace(/\[\[TYPE:.*?\]\]/, '').trim();
    return { content, type };
  }

  async analyzeImage(base64Image: string): Promise<GeminiAnalysisResult> {
    return this.retryWithBackoff(async () => {
      try {
        const prompt = `${SYSTEM_PROMPT}

คุณได้รับรูปภาพจาก user ที่เกี่ยวข้องกับปัญหา IT

กรุณาวิเคราะห์รูปภาพและ:
1. อธิบายว่าเห็นอะไรในรูป (error message, หน้าจอ, อุปกรณ์)
2. ระบุปัญหาที่พบ
3. ให้คำแนะนำวิธีแก้ไขแบบ step-by-step

ตอบเป็นภาษาไทย กระชับ และเข้าใจง่าย`;

        const imagePart = {
          inlineData: {
            data: base64Image,
            mimeType: 'image/jpeg' // LINE ส่งมาเป็น JPEG
          }
        };

        const result = await this.visionModel.generateContent([prompt, imagePart]);
        const response = result.response;
        const text = response.text();

        return {
          description: 'รูปภาพแสดงปัญหา IT',
          response: text
        };
      } catch (error) {
        console.error('Image analysis error:', error);
        return {
          description: 'ไม่สามารถวิเคราะห์รูปภาพได้',
          response: 'ขออภัยครับ ไม่สามารถวิเคราะห์รูปภาพได้ในขณะนี้\n\nกรุณาลองอธิบายปัญหาเป็นข้อความแทน หรือถ่ายรูปใหม่ให้ชัดเจนขึ้น'
        };
      }
    });
  }

  async analyzePDF(base64PDF: string, fileName: string): Promise<GeminiAnalysisResult> {
    return this.retryWithBackoff(async () => {
      try {
        const prompt = `${SYSTEM_PROMPT}

คุณได้รับไฟล์ PDF ชื่อ "${fileName}" จาก user ที่เกี่ยวข้องกับปัญหา IT

กรุณาวิเคราะห์เอกสาร PDF และ:
1. สรุปเนื้อหาหลักที่เกี่ยวข้องกับปัญหา
2. ระบุ error message หรือข้อมูลสำคัญ (ถ้ามี)
3. ให้คำแนะนำการแก้ไขแบบ step-by-step

ตอบเป็นภาษาไทย กระชับ และเข้าใจง่าย`;

        const pdfPart = {
          inlineData: {
            data: base64PDF,
            mimeType: 'application/pdf'
          }
        };

        const result = await this.visionModel.generateContent([prompt, pdfPart]);
        const response = result.response;
        const text = response.text();

        return {
          description: `ไฟล์ PDF: ${fileName}`,
          response: text
        };
      } catch (error) {
        console.error('PDF analysis error:', error);
        return {
          description: `ไฟล์ PDF: ${fileName}`,
          response: 'ขออภัยครับ ไม่สามารถอ่านไฟล์ PDF ได้ในขณะนี้\n\nกรุณา:\n1. ตรวจสอบว่าไฟล์ไม่ได้ล็อกด้วยรหัสผ่าน\n2. ลองแปลงเป็นรูปภาพ (screenshot) แทน\n3. หรืออธิบายปัญหาเป็นข้อความ'
        };
      }
    });
  }

  async analyzeIssue(conversationHistory: IMessage[]): Promise<string> {
    return this.retryWithBackoff(async () => {
      try {
        const messages = conversationHistory
          .filter((msg: IMessage) => msg.role === 'user')
          .map((msg: IMessage) => msg.content)
          .join('\n');

        const prompt = `จากการสนทนาต่อไปนี้ ช่วยสรุปปัญหาหลักที่ user กำลังเผชิญเป็นประโยคสั้นๆ (ไม่เกิน 1 บรรทัด):\n\n${messages}\n\nสรุปปัญหา:`;

        const result = await this.model.generateContent(prompt);
        const response = result.response;

        return response.text().trim();
      } catch (error) {
        console.error('Issue analysis error:', error);
        return 'ไม่สามารถสรุปปัญหาได้';
      }
    });
  }
}

export default new GeminiService();
