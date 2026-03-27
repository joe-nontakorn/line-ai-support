// service/gemini.ts
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

export type MessageRole = 'user' | 'assistant';

export interface IMessage {
  role: MessageRole;
  content: string;
  timestamp?: Date;
}

export type ParsedResponseType = 'IT_PROBLEM' | 'IT_INFO' | 'OUT_OF_SCOPE';

export interface GeminiAnalysisResult {
  description: string;
  response: string;
}

export interface ParsedGeminiResponse {
  content: string;
  type: ParsedResponseType;
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  throw new Error('Missing GEMINI_API_KEY');
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';

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

export class GeminiService {
  private model: GenerativeModel;
  private visionModel: GenerativeModel;
  private readonly maxChatHistoryMessages = 20;
  private readonly maxIssueAnalysisChars = 12000;

  constructor() {
    this.model = genAI.getGenerativeModel({ model: MODEL_NAME });
    this.visionModel = genAI.getGenerativeModel({ model: MODEL_NAME });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isRetryableError(error: unknown): boolean {
    const err = error as { status?: number; message?: string };
    const status = err?.status;
    const message = err?.message || '';

    return (
      status === 429 ||
      status === 500 ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      message.includes('429') ||
      message.toLowerCase().includes('rate limit') ||
      message.toLowerCase().includes('overloaded') ||
      message.toLowerCase().includes('timeout')
    );
  }

  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    retries = 3,
    delayMs = 1500,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (retries > 0 && this.isRetryableError(error)) {
        console.warn(`Gemini retry in ${delayMs}ms (${retries} retries left)`);
        await this.sleep(delayMs);
        return this.retryWithBackoff(fn, retries - 1, delayMs * 2);
      }
      throw error;
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs = 30000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Gemini request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private sanitizeText(text: string): string {
    return text.replace(/\u0000/g, '').trim();
  }

  private normalizeType(rawType?: string): ParsedResponseType {
    const value = (rawType || '').trim().toUpperCase();

    if (value === 'IT_INFO') return 'IT_INFO';
    if (value === 'OUT_OF_SCOPE') return 'OUT_OF_SCOPE';
    return 'IT_PROBLEM';
  }

  private trimConversationHistory(history: IMessage[]): IMessage[] {
    if (history.length <= this.maxChatHistoryMessages) {
      return history;
    }
    return history.slice(-this.maxChatHistoryMessages);
  }

  private toGeminiHistory(messages: IMessage[]) {
    return messages.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: this.sanitizeText(msg.content) }],
    }));
  }

  parseResponse(aiResponse: string): ParsedGeminiResponse {
    const typeMatch = aiResponse.match(/\[\[TYPE:(.*?)\]\]/i);
    const type = this.normalizeType(typeMatch?.[1]);
    const content = aiResponse.replace(/\[\[TYPE:.*?\]\]/gi, '').trim();

    return {
      content: content || 'ขออภัยครับ ไม่สามารถสร้างคำตอบได้ในขณะนี้',
      type,
    };
  }

  async chat(conversationHistory: IMessage[]): Promise<string> {
    return this.retryWithBackoff(async () => {
      try {
        const sanitizedHistory = this.trimConversationHistory(
          conversationHistory
            .map((msg) => ({
              role: msg.role,
              content: this.sanitizeText(msg.content),
              timestamp: msg.timestamp,
            }))
            .filter((msg) => msg.content.length > 0),
        );

        if (sanitizedHistory.length === 0) {
          return 'กรุณาระบุปัญหาด้าน IT ที่ต้องการความช่วยเหลือครับ [[TYPE:IT_PROBLEM]]';
        }

        const history = sanitizedHistory.slice(0, -1);
        const lastMessage = sanitizedHistory[sanitizedHistory.length - 1];

        const chat = this.model.startChat({
          history: [
            {
              role: 'user',
              parts: [{ text: SYSTEM_PROMPT }],
            },
            {
              role: 'model',
              parts: [{ text: 'เข้าใจครับ ผมพร้อมช่วยเหลือเรื่อง IT Support ด้วยความยินดีครับ [[TYPE:IT_INFO]]' }],
            },
            ...this.toGeminiHistory(history),
          ],
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.4,
          },
        });

        const result = await this.withTimeout(chat.sendMessage(lastMessage.content), 30000);
        const responseText = result.response.text()?.trim();

        if (!responseText) {
          return 'ขออภัยครับ ไม่สามารถประมวลผลคำตอบได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง [[TYPE:IT_PROBLEM]]';
        }

        const parsed = this.parseResponse(responseText);

        if (!/\[\[TYPE:.*?\]\]/i.test(responseText)) {
          return `${parsed.content} [[TYPE:${parsed.type}]]`;
        }

        return responseText;
      } catch (error) {
        console.error('Gemini chat error:', error);
        return 'ขออภัยครับ ระบบ AI ไม่สามารถตอบคำถามได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง หรือติดต่อ IT Support [[TYPE:IT_PROBLEM]]';
      }
    });
  }

  async analyzeImage(base64Image: string): Promise<GeminiAnalysisResult> {
    return this.retryWithBackoff(async () => {
      try {
        const prompt = `${SYSTEM_PROMPT}

คุณได้รับรูปภาพจาก user ที่เกี่ยวข้องกับปัญหา IT

กรุณาวิเคราะห์รูปภาพและตอบเป็นภาษาไทย โดยจัดรูปแบบดังนี้:
1. สรุปว่าเห็นอะไรในภาพ
2. ระบุปัญหาที่เป็นไปได้
3. แนะนำวิธีแก้แบบเป็นขั้นตอน
4. ถ้าข้อมูลยังไม่พอ ให้บอกว่าควรถ่ายภาพมุมไหนเพิ่มหรือควรส่งข้อมูลอะไรเพิ่ม

ห้ามตอบนอกเรื่อง และไม่ต้องใส่แท็ก [[TYPE:...]]`;

        const imagePart = {
          inlineData: {
            data: base64Image,
            mimeType: 'image/jpeg',
          },
        };

        const result = await this.withTimeout(
          this.visionModel.generateContent([prompt, imagePart]),
          30000,
        );

        const text = result.response.text()?.trim();

        return {
          description: 'รูปภาพแสดงปัญหา IT',
          response:
            text ||
            'ขออภัยครับ ไม่สามารถวิเคราะห์รูปภาพได้ในขณะนี้\n\nกรุณาลองส่งภาพใหม่ที่ชัดขึ้น หรือพิมพ์อธิบายอาการเพิ่มเติมครับ',
        };
      } catch (error) {
        console.error('Gemini image analysis error:', error);
        return {
          description: 'ไม่สามารถวิเคราะห์รูปภาพได้',
          response:
            'ขออภัยครับ ไม่สามารถวิเคราะห์รูปภาพได้ในขณะนี้\n\nกรุณาลองอธิบายปัญหาเป็นข้อความแทน หรือส่งภาพใหม่ที่ชัดเจนขึ้นครับ',
        };
      }
    });
  }

  async analyzePDF(base64PDF: string, fileName: string): Promise<GeminiAnalysisResult> {
    return this.retryWithBackoff(async () => {
      try {
        const prompt = `${SYSTEM_PROMPT}

คุณได้รับไฟล์ PDF ชื่อ "${fileName}" จาก user ที่เกี่ยวข้องกับปัญหา IT

กรุณาวิเคราะห์เอกสารนี้และตอบเป็นภาษาไทย โดยจัดรูปแบบดังนี้:
1. สรุปว่าเอกสารนี้เกี่ยวกับอะไร
2. ระบุ error message / code / ข้อความสำคัญที่พบ
3. แนะนำวิธีแก้ไขแบบเป็นขั้นตอน
4. ถ้าไฟล์นี้ไม่พอสำหรับวิเคราะห์ ให้บอกว่าต้องการข้อมูลอะไรเพิ่ม

ห้ามตอบนอกเรื่อง และไม่ต้องใส่แท็ก [[TYPE:...]]`;

        const pdfPart = {
          inlineData: {
            data: base64PDF,
            mimeType: 'application/pdf',
          },
        };

        const result = await this.withTimeout(
          this.visionModel.generateContent([prompt, pdfPart]),
          40000,
        );

        const text = result.response.text()?.trim();

        return {
          description: `ไฟล์ PDF: ${fileName}`,
          response:
            text ||
            'ขออภัยครับ ไม่สามารถอ่านไฟล์ PDF ได้ในขณะนี้\n\nกรุณาตรวจสอบว่าไฟล์ไม่ถูกเข้ารหัส และลองส่งใหม่อีกครั้งครับ',
        };
      } catch (error) {
        console.error('Gemini PDF analysis error:', error);
        return {
          description: `ไฟล์ PDF: ${fileName}`,
          response:
            'ขออภัยครับ ไม่สามารถอ่านไฟล์ PDF ได้ในขณะนี้\n\nกรุณา:\n1. ตรวจสอบว่าไฟล์ไม่ถูกล็อกด้วยรหัสผ่าน\n2. ลองส่งหน้าเอกสารที่สำคัญเป็นรูปภาพ\n3. หรือพิมพ์อธิบายปัญหาเป็นข้อความเพิ่มเติมครับ',
        };
      }
    });
  }

  async analyzeIssue(conversationHistory: IMessage[]): Promise<string> {
    return this.retryWithBackoff(async () => {
      try {
        const userMessages = conversationHistory
          .filter((msg) => msg.role === 'user')
          .map((msg) => this.sanitizeText(msg.content))
          .filter(Boolean);

        if (userMessages.length === 0) {
          return 'ไม่สามารถสรุปปัญหาได้';
        }

        let messages = userMessages.join('\n');
        if (messages.length > this.maxIssueAnalysisChars) {
          messages = messages.slice(-this.maxIssueAnalysisChars);
        }

        const prompt = `จากบทสนทนาต่อไปนี้ กรุณาประเมินว่าเป็นปัญหาที่เกี่ยวข้องกับ IT หรือไม่

ตัวอย่างเรื่องที่ถือว่าเกี่ยวกับ IT:
- คอมพิวเตอร์
- อินเทอร์เน็ต
- Wi-Fi
- VPN
- อีเมล
- โปรแกรม
- Printer
- Scanner
- ระบบเครือข่าย
- บัญชีผู้ใช้
- สิทธิ์การเข้าใช้งานระบบ

บทสนทนา:
${messages}

กติกาการตอบ:
- ถ้าเกี่ยวข้องกับ IT: สรุปปัญหาหลักเป็นประโยคสั้น ๆ ภาษาไทย ไม่เกิน 1 บรรทัด
- ถ้าไม่เกี่ยวข้องกับ IT: ตอบเพียงคำเดียวว่า NON_IT_ISSUE
- ห้ามอธิบายเพิ่ม
- ห้ามขึ้นหลายบรรทัด`;

        const result = await this.withTimeout(
          this.model.generateContent(prompt),
          20000,
        );

        const text = result.response.text()?.trim();

        if (!text) {
          return 'ไม่สามารถสรุปปัญหาได้';
        }

        return text;
      } catch (error) {
        console.error('Gemini issue analysis error:', error);
        return 'ไม่สามารถสรุปปัญหาได้';
      }
    });
  }
}

export default new GeminiService();