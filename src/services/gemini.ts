import { GoogleGenerativeAI, GenerativeModel, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import Ticket from '../models/Ticket.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type MessageRole = 'user' | 'assistant' | 'system';

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
  topic?: string;
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  throw new Error('Missing GEMINI_API_KEY');
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const MODEL_NAME = process.env.GEMINI_MODEL!;
logger.info(`[Gemini] Using model: ${MODEL_NAME}`);

const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

// ──────────────────────────────────────────────
// Load Company Security Policy (P-02)
// ──────────────────────────────────────────────
const COMPANY_POLICY = `
# Information Security Regulations (P-02)
## JasTel Network Co.,Ltd.

## 1. ขอบข่าย (Scope)
- ใช้กับพนักงาน, Supplier และบุคคลภายนอกที่เกี่ยวข้อง
- ต้องปฏิบัติตามกฎหมายและข้อกำหนดที่เกี่ยวข้อง

## 2. คำจำกัดความ
- **สื่อบันทึกข้อมูลพกพา**: เช่น USB, External HDD, CD/DVD, Mobile, Notebook
- **เครือข่าย**: ระบบ IT ของบริษัท

## 3. การใช้งานทรัพยากรสารสนเทศ
### แนวทางสำคัญ
- ห้ามเข้าถึงข้อมูล/ระบบที่ไม่ได้รับอนุญาต
- ห้ามให้บุคคลภายนอกใช้ระบบบริษัท
- ห้ามใช้งานผิดกฎหมาย/ขัดนโยบายองค์กร
- ต้องตั้ง Screen Lock ภายใน 5 นาที

### Password Policy
- ความยาว 8–12 ตัวอักษร
- มีตัวใหญ่/เล็ก + ตัวเลข + อักขระพิเศษ
- เปลี่ยนเมื่อถูก Hack (อ้างอิง NIST)

### ข้อห้าม
- ห้ามแชร์รหัสผ่าน
- ห้ามติดตั้ง Software เอง (ต้องผ่าน ADS / Whitelist)
- ห้ามใช้เครื่องมือ Hack เช่น sniffer / scanner
- ห้ามเข้าถึงเว็บไซต์ไม่เหมาะสม

## 4. การใช้งาน Email
- ใช้ Email องค์กรเท่านั้น (Microsoft 365)
- ข้อมูลที่ส่งออกต้องจัดชั้นความลับ (ISD-84)
- Email ถูกบันทึกและตรวจสอบได้
- IT มีสิทธิ์ตรวจสอบโดยไม่แจ้งล่วงหน้า

## 5. การใช้งานสื่อบันทึกข้อมูลพกพา (BYOD)
- ต้องขออนุญาตก่อนใช้อุปกรณ์ส่วนตัว
- ต้องลงทะเบียนกับ ADS
- ห้ามติดตั้ง/แก้ไข Software/Hardware เอง
- ต้องมี Antivirus และอัปเดตเสมอ
- หากอุปกรณ์หาย ต้องแจ้งทันที

## 6. การจัดการข้อมูล (Information Asset)
- เก็บข้อมูลในระบบที่บริษัทกำหนด (M365, SAP, Salesforce)
- กำหนดสิทธิ์การเข้าถึงตามระดับความลับ

## 7. การแลกเปลี่ยนข้อมูล
- ต้องมี NDA (ข้อตกลงรักษาความลับ)
- ต้อง Scan Virus ทุกครั้ง
- ห้ามใช้ USB ส่งข้อมูลลับออกนอกองค์กร
- แนะนำใช้ M365 เป็นหลัก
`;

logger.info('[Gemini] Company policy embedded successfully');

// ฟังก์ชันสร้างข้อความแจ้งผู้ใช้เมื่อเกิด Error ของ AI
function getAIErrorMessage(error: unknown): string {
  const err = error as { status?: number; message?: string };
  const errorMsg = (err?.message || '').toLowerCase();

  if (err?.status === 429 || errorMsg.includes('429') || errorMsg.includes('rate limit')) {
    return 'เซิร์ฟเวอร์ AI มีผู้ใช้งานจำนวนมากในขณะนี้ (Rate Limit) กรุณารอสักครู่แล้วลองใหม่อีกครั้ง';
  } else if (err?.status === 503 || errorMsg.includes('503') || errorMsg.includes('high demand') || errorMsg.includes('overloaded')) {
    return 'ส่วนประมวลผล AI ของ Google มีความหนาแน่นมาก (High Demand / Service Unavailable) กรุณารอสักครู่แล้วลองใหม่อีกครั้ง';
  } else if (errorMsg.includes('timeout') || err?.message?.includes('timeout')) {
    return 'การส่งข้อมูลไปวิเคราะห์ที่ AI ใช้เวลานานเกินกำหนด (Timeout) อาจจะเพราะระบบต้นทางล่าช้า กรุณาลองใหม่อีกครั้ง';
  } else if (errorMsg.includes('safety') || errorMsg.includes('blocked')) {
    return 'เนื้อหามีข้อมูลที่ถูกระบบความปลอดภัย (Safety Policy) ของ AI บล็อกไว้ ไม่สามารถวิเคราะห์ได้';
  }

  return 'เกิดข้อผิดพลาดในการเชื่อมต่อกับเซิร์ฟเวอร์ AI';
}

// ──────────────────────────────────────────────
// System Prompt: หัวใจของ AI IT Support
// ──────────────────────────────────────────────
const BASE_SYSTEM_PROMPT = `คุณชื่อ "Jastel IT Helper" เป็น AI IT Support ของ Jastel Network
ตอบเป็นภาษาไทย กระชับ อ่านง่ายบนมือถือ

**สภาพแวดล้อมบริษัท:** พนักงานทุกคนใช้ Windows เท่านั้น (ไม่มี Mac) อีเมลใช้ Microsoft 365/Outlook เท่านั้น (ไม่ใช่ Gmail)

**ขอบเขต:** คอมพิวเตอร์ Windows, เครือข่าย/Wi-Fi/VPN/LAN, Outlook/Teams/SharePoint, M365/SAP/ERP/Adobe, Printer/Scanner, บัญชีผู้ใช้/รหัสผ่าน, ไวรัส/Phishing, ฮาร์ดแวร์/ซอฟต์แวร์

**กฎการตอบ:**
1. ถ้าข้อมูลไม่ชัด ถามกลับก่อน (เช่น "ลืมรหัสผ่าน" → ถามว่าระบบอะไร)
2. ตอบเป็นขั้นตอน 1,2,3 สั้นกระชับ แนะนำเฉพาะ Windows
3. แจ้งปัญหา → ปิดท้าย "กดปุ่ม 'ยังแก้ไม่ได้' เพื่อแจ้ง IT"
4. สอบถามข้อมูล → ปิดท้าย "สอบถามเพิ่มเติมได้เลยครับ"
5. ถ้าต้อง Remote/เข้าระบบจริง → แนะนำติดต่อ IT Support
6. คำถามนอกเรื่อง IT → "ขออภัยครับ อยู่นอกขอบเขต IT Support ครับ"
7. หากคุณ (AI) ไม่มีข้อมูล ไม่สามารถตอบได้ หรือหาสาเหตุไม่เจอ ให้คุณวิเคราะห์สถานการณ์แบบฉลาดๆ พร้อมอธิบายให้ User ฟังตรงๆ ว่าทำไมคุณถึงตอบไม่ได้ แล้วจึงแนะนำให้ติดต่อเจ้าหน้าที่ IT (อย่าให้คำตอบมั่วๆ)
8. ห้ามแนะนำ Software ผิดลิขสิทธิ์ ห้ามเปิดเผยข้อมูลส่วนตัว

**แท็ก (ต้องใส่ท้ายทุกคำตอบ):**
- [[TYPE:IT_PROBLEM]] แก้ปัญหา IT
- [[TYPE:IT_INFO]] ให้ข้อมูล/นโยบาย
- [[TYPE:OUT_OF_SCOPE]] นอกขอบเขต
- [[TOPIC:สรุปหัวข้อสั้นๆ]] เช่น [[TOPIC:ลืมรหัสผ่าน M365]]`;

// ฟังก์ชันดึง System Prompt แบบไดนามิก - ป้องกันการโหลดไฟล์ Policy ทะลักเข้ามาทุกครั้ง เพื่อให้ AI ตอบเร็วขึ้น
function getSystemPrompt(userInput: string = ''): string {
  // ตรวจสอบคำที่อาจจะเกี่ยวข้องกับ Policy เช่น รหัสผ่าน กฎ นโยบาย ฯลฯ
  const needsPolicy = /นโยบาย|กฎ|ระเบียบ|ข้อบังคับ|policy|รหัสผ่าน|password|vpn|ความปลอดภัย|security/i.test(userInput);

  if (needsPolicy && COMPANY_POLICY) {
    return BASE_SYSTEM_PROMPT + `\n\n═══════════════════════════════════════
📜 กฎระเบียบและความปลอดภัยสารสนเทศของบริษัท (Company Policy):
คุณต้องยึดถือข้อมูลจากไฟล์นโยบายนี้เป็นหลัก หากมีคำบอกกล่าวที่ขัดแย้งกับข้อมูลทั่วไป ให้ยึดตามนี้เท่านั้น:
${COMPANY_POLICY}
═══════════════════════════════════════

📌 **คำสั่งพิเศษสำหรับการตอบคำถามเกี่ยวกับกฎระเบียบ:**
- หากพนักงานถามเกี่ยวกับ Password, การใช้งานอุปกรณ์ส่วนตัว (BYOD), การติดตั้ง Software, หรือการโอนย้ายข้อมูล
- ให้ตอบโดยขึ้นต้นหรือระบุว่า "ตามนโยบายความปลอดภัยสารสนเทศของบริษัท (P-02)..."
- ห้ามแนะนำสิ่งที่ขัดต่อหลักการในนโยบายนี้เด็ดขาด`;
  }
  return BASE_SYSTEM_PROMPT;
}

// ──────────────────────────────────────────────
// Semaphore: จำกัด concurrent API calls
// ป้องกัน Rate Limit เมื่อหลายคนแชทพร้อมกัน
// ──────────────────────────────────────────────
class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private maxConcurrency: number) { }

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
  private readonly maxChatHistoryMessages = 6;
  private readonly maxIssueAnalysisChars = 12000;

  // Concurrency control: จำกัดไม่เกิน 10 requests พร้อมกัน
  private chatSemaphore = new Semaphore(10);
  private analysisSemaphore = new Semaphore(5);

  constructor() {
    this.model = genAI.getGenerativeModel({ model: MODEL_NAME });
    this.visionModel = genAI.getGenerativeModel({ model: MODEL_NAME });
  }

  private async searchRelatedTickets(queryText: string): Promise<string> {
    try {
      if (!queryText || queryText.trim().length < 3) return '';

      const tickets = await Ticket.find(
        {
          $text: { $search: queryText },
          status: 'resolved',
          resolutionComment: { $ne: '' }
        },
        { score: { $meta: "textScore" } }
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(3)
        .lean();

      if (!tickets || tickets.length === 0) return '';

      let contextStr = '\n\n═══════════════════════════════════════\n';
      contextStr += '📚 ข้อมูลอ้างอิงจากประวัติการแก้ปัญหาในอดีต (Knowledge Base ของ Jastel):\n';
      contextStr += 'ด้านล่างนี้คือประวัติการซ่อมตั๋วที่มีปัญหาคล้ายคลึงกันและได้รับการแก้ไขสำเร็จแล้ว ให้ใช้เป็นแนวทางอ้างอิงในการตอบหรือเสนอแนะ\n\n';

      tickets.forEach((t, i) => {
        contextStr += `[ประวัติเคสที่ ${i + 1}] อาการที่แจ้ง: ${t.issueSummary}\n`;
        contextStr += `🟢 วิธีแก้จนสำเร็จ (จากฝ่าย IT): ${t.resolutionComment}\n\n`;
      });
      contextStr += '═══════════════════════════════════════\n';

      return contextStr;
    } catch (e) {
      logger.error('Error in RAG searchRelatedTickets:', e);
      return '';
    }
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
      message.toLowerCase().includes('overloaded')
    );
  }

  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    retries = 1,
    delayMs = 1000,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (retries > 0 && this.isRetryableError(error)) {
        // เพิ่ม jitter เพื่อกระจาย retry ไม่ให้ชนกัน
        const jitter = Math.random() * 500;
        const totalDelay = delayMs + jitter;
        logger.warn(`Gemini retry in ${Math.round(totalDelay)}ms (${retries} retries left) | Load: ${this.chatSemaphore.currentLoad}/${this.chatSemaphore.queueLength} queued`);
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

    const topicMatch = aiResponse.match(/\[\[TOPIC:(.*?)\]\]/i);
    const topic = topicMatch ? topicMatch[1].trim() : undefined;

    const content = aiResponse.replace(/\[\[TYPE:.*?\]\]/gi, '').replace(/\[\[TOPIC:.*?\]\]/gi, '').trim();

    return {
      content: content || 'ขออภัยครับ ไม่สามารถสร้างคำตอบได้ในขณะนี้',
      type,
      topic,
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
          return 'กรุณาระบุปัญหาด้าน IT ที่ต้องการความช่วยเหลือครับ [[TYPE:IT_PROBLEM]] [[TOPIC:ไม่ระบุ]]';
        }

        const history = sanitizedHistory.slice(0, -1);
        const lastMessage = sanitizedHistory[sanitizedHistory.length - 1];

        // RAG System: เอาข้อความล่าสุดของผู้ใช้ไปค้นในอดีต (Ticket DB)
        const searchContext = await this.searchRelatedTickets(lastMessage.content);

        const chat = this.model.startChat({
          history: [
            {
              role: 'user',
              parts: [{ text: getSystemPrompt(lastMessage.content) + searchContext }],
            },
            {
              role: 'model',
              parts: [{ text: 'เข้าใจครับ ผม Jastel IT Helper พร้อมช่วยเหลือเรื่อง IT Support ด้วยความยินดีครับ สอบถามปัญหาได้เลยครับ [[TYPE:IT_INFO]] [[TOPIC:ไม่ระบุ]]' }],
            },
            ...this.toGeminiHistory(history),
          ],
          generationConfig: {
            maxOutputTokens: 800,
            temperature: 0.3,
            topP: 0.85,
            topK: 40,
            // ปิด Thinking mode เพื่อประหยัดค่าใช้จ่าย (เผื่อเปลี่ยนไปใช้ 2.5 Flash)
            // @ts-ignore - Ignore type error as SDK might not have types for this yet
            thinkingConfig: { thinkingBudget: 0 },
          },
          safetySettings,
        });

        const result = await this.withTimeout(chat.sendMessage(lastMessage.content), 30000);
        const responseText = result.response.text()?.trim();

        if (!responseText) {
          return 'ขออภัยครับ ไม่สามารถประมวลผลคำตอบได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง [[TYPE:IT_PROBLEM]] [[TOPIC:ไม่ระบุ]]';
        }

        const parsed = this.parseResponse(responseText);

        if (!/\[\[TYPE:.*?\]\]/i.test(responseText)) {
          return `${parsed.content} [[TYPE:${parsed.type}]]`;
        }

        return responseText;
      } catch (error) {
        const err = error as { status?: number; message?: string; stack?: string };
        logger.error(`Gemini chat error: status=${err?.status} message=${err?.message}`, error);

        const smartReason = getAIErrorMessage(error);
        return `ขออภัยระบบขัดข้องครับ 🤖\n\nระบบวิเคราะห์ AI ไม่สามารถตอบคำถามได้ในขณะนี้เนื่องจาก: "${smartReason}"\n\n📌 กรุณาลองใหม่อีกครั้ง หรือถ้าเร่งด่วนกดปุ่ม "ติดต่อเจ้าหน้าที่" เพื่อให้ IT Support เข้าดูแลได้เลยครับ [[TYPE:IT_PROBLEM]] [[TOPIC:ไม่ระบุ]]`;
      }
    });
  }

  async analyzeImage(base64Image: string, userText?: string): Promise<GeminiAnalysisResult> {
    await this.analysisSemaphore.acquire();
    try {
      return await this._analyzeImageInternal(base64Image, userText);
    } finally {
      this.analysisSemaphore.release();
    }
  }

  private async _analyzeImageInternal(base64Image: string, userText?: string): Promise<GeminiAnalysisResult> {
    return this.retryWithBackoff(async () => {
      try {
        let prompt = `${getSystemPrompt()}

คุณได้รับรูปภาพจาก user ที่เกี่ยวข้องกับปัญหา IT
`;
        if (userText) {
          prompt += `\nUser ส่งข้อความเพิ่มเติมมาพร้อมกับรูปภาพว่า: "${userText}"\n`;
        }

        prompt += `
กรุณาวิเคราะห์รูปภาพประกอบกับข้อความ (ถ้ามี) และตอบเป็นภาษาไทย โดยจัดรูปแบบดังนี้:
1. สรุปว่าเห็นอะไรในภาพ
2. ระบุปัญหาที่เป็นไปได้
3. แนะนำวิธีแก้แบบเป็นขั้นตอน
4. ถ้าข้อมูลยังไม่พอ ให้บอกว่าควรถ่ายภาพมุมไหนเพิ่มหรือควรส่งข้อมูลอะไรเพิ่ม

*กรณีพิเศษ*: หากในภาพเป็นหน้าจอ User Account Control (UAC) หรือหน้าต่างที่ถามหารหัสผ่าน Admin (เพื่อสิทธิ์ในการติดตั้งโปรแกรมหรือยืนยันระบบ) 
ให้ตอบโดยระบุชัดเจนว่า "ปัญหานี้ติดสิทธิ์ Admin ของเครื่อง จำเป็นต้องให้เจ้าหน้าที่ IT ดำเนินการให้ กรุณากดปุ่ม 'ติดต่อเจ้าหน้าที่' หรือแจ้งเปิด Ticket เพื่อให้ IT เข้าช่วยเหลือครับ"

ห้ามตอบนอกเรื่อง และไม่ต้องใส่แท็ก [[TYPE:...]]`;

        const imagePart = {
          inlineData: {
            data: base64Image,
            mimeType: 'image/jpeg',
          },
        };

        const result = await this.withTimeout(
          this.visionModel.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }, imagePart] }],
            safetySettings
          }),
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
        logger.error('Gemini image analysis error:', error);
        const smartReason = getAIErrorMessage(error);
        return {
          description: 'ไม่สามารถวิเคราะห์รูปภาพได้',
          response:
            `ขออภัยระบบขัดข้องครับ 🤖\n\nระบบไม่สามารถวิเคราะห์รูปภาพได้ในขณะนี้เนื่องจาก: "${smartReason}"\n\n📌 กรุณาลองอธิบายปัญหาเป็นข้อความแทน หรือกด "ติดต่อเจ้าหน้าที่" ครับ`,
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
        const prompt = `${getSystemPrompt()}

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
          this.visionModel.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }, pdfPart] }],
            safetySettings
          }),
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
        logger.error('Gemini PDF analysis error:', error);
        const smartReason = getAIErrorMessage(error);
        return {
          description: `ไฟล์ PDF: ${fileName}`,
          response:
            `ขออภัยระบบขัดข้องครับ 🤖\n\nระบบไม่สามารถอ่านไฟล์ PDF ได้ในขณะนี้เนื่องจาก: "${smartReason}"\n\n📌 กรุณาลองอธิบายปัญหาเป็นข้อความแทน หรือกด "ติดต่อเจ้าหน้าที่" ครับ`,
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
- อีเมล (Microsoft Outlook, Microsoft 365)
- โปรแกรม (Microsoft Office/System, SAP, ERP, Teams)
- Printer, Scanner
- ระบบเครือข่าย
- บัญชีผู้ใช้, รหัสผ่าน Microsoft 365
- สิทธิ์การเข้าใช้งานระบบ

ตัวอย่างเรื่องที่ไม่เกี่ยวกับ IT (ระบบจะไม่บันทึก):
- เรื่องอาคารสถานที่ (ปลวกขึ้น, ท่อน้ำรั่ว, แอร์ไม่เย็น, หลอดไฟขาด)
- เรื่องทั่วไป (รถเสีย, สภาพอากาศ, ข่าวสาร, ดูดวง)
- เรื่องส่วนตัวหรือแผนกอื่นที่ไม่มีระบบสารสนเทศมาเกี่ยวข้อง
- ข้อความที่บอกว่าไม่มีปัญหา, แก้ไขได้แล้ว, ทำได้สำเร็จแล้ว หรือแจ้งให้ทราบเฉยๆ (เช่น "sign in 365 บนมือถือได้", "เข้าสู่ระบบได้แล้ว", "ขอบคุณครับ")

บทสนทนา:
${messages}

กติกาการตอบ:
- ถ้าเกี่ยวข้องกับ IT: สรุปปัญหาหลักเป็นภาษาไทยอย่างกระชับแต่ครบถ้วน **หากผู้ใช้มีการระบุข้อมูลทางเทคนิค (เช่น IP Address, Port, ชื่อ Server, Error Code) ต้องคงข้อมูลเหล่านั้นไว้ในสรุปด้วย ห้ามตัดทิ้งเด็ดขาด** (สรุปยาวกว่า 1 บรรทัดได้หากรายละเอียดสำคัญ)
- ถ้าไม่เกี่ยวข้องกับ IT: ตอบเพียงคำเดียวว่า NON_IT_ISSUE
- ไม่ต้องเกริ่นนำ หรือลงท้ายใดๆ`;

        const result = await this.withTimeout(
          this.model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            safetySettings
          }),
          40000,
        );

        const text = result.response.text()?.trim();

        if (!text) {
          return 'ไม่สามารถสรุปปัญหาได้';
        }

        return text;
      } catch (error) {
        logger.error('Gemini issue analysis error:', error);
        return 'ไม่สามารถสรุปปัญหาได้';
      }
    });
  }

  async clarifyIssue(issueSummary: string): Promise<string> {
    await this.analysisSemaphore.acquire();
    try {
      const prompt = `คุณคือผู้ช่วยฝ่าย IT Support ที่มีความสุภาพและต้องการให้ข้อมูลเบื้องต้นกับเจ้าหน้าที่ฝ่ายเทคนิคให้มากที่สุด

หากผู้ใช้แจ้งปัญหาที่สั้นหรือกว้างจนเกินไป (เช่น "ช่วยด้วย", "มีปัญหา", "พัง", "เข้าไม่ได้") โดยไม่บอกรายละเอียดอาการ หรือระบบที่ใช้
จงถามคำถามเจาะจง 1 ประโยคเพื่อให้ผู้ใช้ให้รายละเอียดเพิ่ม (เช่น "รบกวนแจ้งระบบหรือโปรแกรมที่คุณพบปัญหาเพื่อการตรวจสอบที่รวดเร็วครับ")

แต่ถ้าผู้ใช้แจ้งรายละเอียดมาพอสมควรแล้ว (เช่น "เข้า Wi-Fi ชั้น 7 ไม่ได้", "Printer HP ที่ MTN พิมพ์ไม่ออก") ให้ตอบเพียงคำเดียวว่า: CLEAR

ปัญหาที่ได้รับ: "${issueSummary}"

กติกา:
- ถามเป็นภาษาไทยอย่างสุภาพ
- ถามเพียงประโยคเดียวสั้นๆ
- ห้ามถามย้อนความเดิม
- ถ้าชัดเจนแล้วต้องตอบ CLEAR เท่านั้น`;

      const result = await this.withTimeout(
        this.model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          safetySettings
        }),
        20000,
      );

      const text = result.response.text()?.trim() || 'CLEAR';
      return text;
    } catch (error) {
      logger.error('Gemini clarify issue error:', error);
      return 'CLEAR'; // Fallback to clear if AI fails
    } finally {
      this.analysisSemaphore.release();
    }
  }

  async getTroubleshootingAdvice(issueSummary: string): Promise<string> {
    await this.analysisSemaphore.acquire();
    try {
      const searchContext = await this.searchRelatedTickets(issueSummary);

      const prompt = `คุณคือผู้เชี่ยวชาญด้าน IT Support
ผู้ใช้กำลังประสบปัญหา: "${issueSummary}"

${searchContext ? `และนี่คือประวัติของบริษัทที่มีอาการคล้ายกัน ซึ่งเพิ่งถูกดำเนินการแก้ไขสำเร็จ:\n${searchContext}` : ''}

กรุณาแนะนำวิธีแก้ไขเบื้องต้น 2-3 ข้อสั้นๆ ที่พนักงานสามารถทำได้ด้วยตัวเอง (Self-Service)
เพื่อประหยัดเวลาและอาจแก้ปัญหาได้ทันที

กติกา:
- ใช้ภาษาไทยที่เป็นกันเองและสุภาพ
- ตอบเป็นข้อๆ สั้นๆ (Bullet points)
- รวมกันไม่เกิน 100-150 คำ
- เน้นสิ่งที่ทำได้ง่าย เช่น "รีสตาร์ทเครื่อง", "เช็กสาย LAN", "ลบ Cache"
- ถ้าชื่อปัญหากว้างเกินไป ให้แนะนำการเช็กพื้นฐานกลางๆ

คำแนะนำที่ต้องการ:`;

      const result = await this.withTimeout(
        this.model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          safetySettings
        }),
        30000,
      );

      return result.response.text()?.trim() || 'ขออภัยครับ ไม่สามารถสร้างคำแนะนำได้ในขณะนี้';
    } catch (error) {
      logger.error('Gemini troubleshooting error:', error);
      return 'กรุณาลองรีสตาร์ทเครื่องหรืออุปกรณ์เบื้องต้นดูนะครับ';
    } finally {
      this.analysisSemaphore.release();
    }
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
