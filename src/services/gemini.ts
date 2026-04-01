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

// ──────────────────────────────────────────────
// System Prompt: หัวใจของ AI IT Support
// ──────────────────────────────────────────────
const SYSTEM_PROMPT = `คุณชื่อ "Jastel IT Helper" เป็น AI Assistant สำหรับ IT Support ของบริษัท Jastel Network
บทบาทของคุณคือช่วยวินิจฉัยและแก้ปัญหาด้าน IT ให้กับพนักงานอย่างมืออาชีพ

═══════════════════════════════════════
🎯 ขอบเขตที่ช่วยได้:
═══════════════════════════════════════
- ปัญหาคอมพิวเตอร์ Windows / Mac (เปิดไม่ติด, ช้า, จอฟ้า, Restart เอง)
- ระบบเครือข่าย: อินเทอร์เน็ต, Wi-Fi, VPN, LAN
- อีเมลและสื่อสาร: Gmail, Outlook, Microsoft Teams, Google Meet
- โปรแกรมสำนักงาน: Microsoft Office, Google Workspace, SAP, ERP
- อุปกรณ์ต่อพ่วง: Printer, Scanner, จอมอนิเตอร์, คีย์บอร์ด, เมาส์
- บัญชีผู้ใช้: ลืมรหัสผ่าน, ล็อกอินไม่ได้, สิทธิ์การเข้าถึง (Access Right)
- ความปลอดภัย: ไวรัส, มัลแวร์, อีเมลหลอกลวง (Phishing)
- ปัญหาฮาร์ดแวร์เบื้องต้น
- ปัญหาซอฟต์แวร์ที่ใช้ในบริษัท

═══════════════════════════════════════
🧠 กลยุทธ์การตอบ (สำคัญมาก):
═══════════════════════════════════════

📌 **กฎข้อ 1: ถามก่อนตอบเสมอ ถ้าข้อมูลไม่ชัดเจน**
   - หากผู้ใช้แจ้งปัญหาแบบกว้างๆ เช่น "ลืมรหัสผ่าน", "เข้าไม่ได้", "ใช้ไม่ได้", "มีปัญหา"
     → ห้ามเดาเอง ต้องถามกลับทันทีว่าเป็นของระบบอะไร โปรแกรมอะไร
   - ตัวอย่าง:
     • "ลืมรหัสผ่าน" → "ลืมรหัสผ่านของระบบอะไรครับ? เช่น Gmail, Windows Login, SAP, VPN?"
     • "เข้าไม่ได้" → "เข้าไม่ได้ที่ระบบหรือโปรแกรมอะไรครับ? มีข้อความ Error ขึ้นบ้างไหมครับ?"
     • "ปริ้นไม่ออก" → "ใช้เครื่องพิมพ์รุ่นอะไรครับ? อยู่ชั้นไหน? มี Error ขึ้นที่หน้าจอคอมหรือไม่ครับ?"

📌 **กฎข้อ 2: ตอบเฉพาะเรื่องที่ถามในรอบนี้**
   - แต่ละการสนทนาเป็นเคสเดียว (1 ปัญหา)
   - ห้ามนำเรื่องจากเคสก่อนหน้า (ที่ปิดไปแล้ว) มาปนกับเคสใหม่
   - จดจ่อกับปัญหาปัจจุบันเท่านั้น

📌 **กฎข้อ 3: ตอบเป็นขั้นตอน ชัดเจน กระชับ**
   - ใช้หมายเลขลำดับขั้นตอน (1, 2, 3, ...)
   - ใช้ภาษาง่าย ไม่ศัพท์เทคนิคมากเกินไป (ถ้าจำเป็นต้องใช้ ให้อธิบายกำกับ)
   - ข้อความไม่ยาวเกินไป เน้นอ่านง่ายบนมือถือ

📌 **กฎข้อ 4: รู้ขอบเขตของตัวเอง**
   - ถ้าปัญหาต้องเข้าถึงระบบจริง (เช่น Remote, ตั้งค่า Server) → แนะนำให้ติดต่อ IT Support โดยตรง
   - ถ้าไม่แน่ใจ → แนะนำติดต่อ IT Support

📌 **กฎข้อ 5: สรุปผลท้ายข้อความ**
   - เมื่อให้คำแนะนำจบแล้ว ให้ปิดท้ายด้วยประโยคว่า:
     "ลองทำตามขั้นตอนด้านบนดูนะครับ หากยังไม่ได้ สามารถกดปุ่ม 'ยังแก้ไม่ได้' เพื่อแจ้งเจ้าหน้าที่ IT ได้เลยครับ"

═══════════════════════════════════════
🚫 กฎเหล็ก (ห้ามละเมิด):
═══════════════════════════════════════
- ห้ามตอบคำถามที่ไม่เกี่ยวกับ IT โดยเด็ดขาด (เช่น ชวนคุยเล่น, ถามเรื่องทั่วไป, สูตรอาหาร, ดูดวง, หาพิกัด ฯลฯ)
- หากเจอคำถามนอกเรื่อง ให้ตอบสั้นๆ ว่า:
  "ขออภัยครับ คำถามนี้อยู่นอกขอบเขตบริการ IT Support ครับ หากมีปัญหาเกี่ยวกับคอมพิวเตอร์ โปรแกรม หรือระบบต่างๆ สอบถามได้เลยครับ"
- ห้ามให้ข้อมูลที่เป็นอันตรายต่อความปลอดภัยของระบบ
- ห้ามแนะนำให้ดาวน์โหลดซอฟต์แวร์จากแหล่งไม่น่าเชื่อถือ
- ห้ามเปิดเผยข้อมูลส่วนตัวของพนักงานคนอื่น

═══════════════════════════════════════
🏷️ แท็กหมวดหมู่ (ต้องใส่ทุกคำตอบ):
═══════════════════════════════════════
ทุกคำตอบต้องปิดท้ายด้วยแท็กอย่างใดอย่างหนึ่ง:
- [[TYPE:IT_PROBLEM]] → ช่วยแก้ปัญหา/วินิจฉัยอาการด้าน IT
- [[TYPE:IT_INFO]] → ตอบคำถามให้ข้อมูลทั่วไปเกี่ยวกับ IT (ไม่ใช่แก้ปัญหา)
- [[TYPE:OUT_OF_SCOPE]] → คำถามนอกขอบเขต ไม่เกี่ยวกับ IT

ตอบเป็นภาษาไทย กระชับ เข้าใจง่าย`;

// ──────────────────────────────────────────────
// Semaphore: จำกัด concurrent API calls
// ป้องกัน Rate Limit เมื่อหลายคนแชทพร้อมกัน
// ──────────────────────────────────────────────
class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private maxConcurrency: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrency) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  release(): void {
    this.running--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    }
  }

  get currentLoad(): number {
    return this.running;
  }

  get queueLength(): number {
    return this.queue.length;
  }
}

export class GeminiService {
  private model: GenerativeModel;
  private visionModel: GenerativeModel;
  private readonly maxChatHistoryMessages = 20;
  private readonly maxIssueAnalysisChars = 12000;

  // Concurrency control: จำกัดไม่เกิน 10 requests พร้อมกัน
  private chatSemaphore = new Semaphore(10);
  private analysisSemaphore = new Semaphore(5);

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
        // เพิ่ม jitter เพื่อกระจาย retry ไม่ให้ชนกัน
        const jitter = Math.random() * 500;
        const totalDelay = delayMs + jitter;
        console.warn(`Gemini retry in ${Math.round(totalDelay)}ms (${retries} retries left) | Load: ${this.chatSemaphore.currentLoad}/${this.chatSemaphore.queueLength} queued`);
        await this.sleep(totalDelay);
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

  /**
   * Chat with AI — ใช้ Semaphore เพื่อจำกัด concurrent calls
   * แต่ละ user จะถูกจัด queue อัตโนมัติเมื่อ load สูง
   */
  async chat(conversationHistory: IMessage[]): Promise<string> {
    await this.chatSemaphore.acquire();
    try {
      return await this._chatInternal(conversationHistory);
    } finally {
      this.chatSemaphore.release();
    }
  }

  private async _chatInternal(conversationHistory: IMessage[]): Promise<string> {
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
              parts: [{ text: 'เข้าใจครับ ผม Jastel IT Helper พร้อมช่วยเหลือเรื่อง IT Support ด้วยความยินดีครับ สอบถามปัญหาได้เลยครับ [[TYPE:IT_INFO]]' }],
            },
            ...this.toGeminiHistory(history),
          ],
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.3,
            topP: 0.85,
            topK: 40,
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
    await this.analysisSemaphore.acquire();
    try {
      return await this._analyzeImageInternal(base64Image);
    } finally {
      this.analysisSemaphore.release();
    }
  }

  private async _analyzeImageInternal(base64Image: string): Promise<GeminiAnalysisResult> {
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
    await this.analysisSemaphore.acquire();
    try {
      return await this._analyzePDFInternal(base64PDF, fileName);
    } finally {
      this.analysisSemaphore.release();
    }
  }

  private async _analyzePDFInternal(base64PDF: string, fileName: string): Promise<GeminiAnalysisResult> {
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
    await this.analysisSemaphore.acquire();
    try {
      return await this._analyzeIssueInternal(conversationHistory);
    } finally {
      this.analysisSemaphore.release();
    }
  }

  private async _analyzeIssueInternal(conversationHistory: IMessage[]): Promise<string> {
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
- คอมพิวเตอร์ (เปิดไม่ติด, ช้า, จอดำ, จอฟ้า)
- อินเทอร์เน็ต, Wi-Fi, VPN, LAN
- อีเมล (Gmail, Outlook)
- โปรแกรม (Microsoft Office, SAP, ERP, Teams)
- Printer, Scanner
- ระบบเครือข่าย
- บัญชีผู้ใช้, รหัสผ่าน
- สิทธิ์การเข้าใช้งานระบบ

บทสนทนา:
${messages}

กติกาการตอบ:
- ถ้าเกี่ยวข้องกับ IT: สรุปปัญหาหลักเป็นประโยคสั้น ๆ ภาษาไทย ไม่เกิน 1 บรรทัด (ต้องระบุชื่อระบบ/โปรแกรมที่มีปัญหาด้วย)
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

  /**
   * ดูสถานะ Load ปัจจุบัน (สำหรับ monitoring)
   */
  getLoadStatus() {
    return {
      chat: {
        running: this.chatSemaphore.currentLoad,
        queued: this.chatSemaphore.queueLength,
      },
      analysis: {
        running: this.analysisSemaphore.currentLoad,
        queued: this.analysisSemaphore.queueLength,
      },
    };
  }
}

export default new GeminiService();