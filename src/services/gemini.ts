import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
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

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';

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

// ──────────────────────────────────────────────
// System Prompt: หัวใจของ AI IT Support
// ──────────────────────────────────────────────
const BASE_SYSTEM_PROMPT = `คุณชื่อ "Jastel IT Helper" เป็น AI Assistant สำหรับ IT Support ของบริษัท Jastel Network
บทบาทของคุณคือช่วยวินิจฉัยและแก้ปัญหาด้าน IT ให้กับพนักงานอย่างมืออาชีพ โดยใช้กฎระเบียบของบริษัทเป็นบรรทัดฐานสูงสุด

🎯 ขอบเขตที่ช่วยได้:
═══════════════════════════════════════
- ปัญหาคอมพิวเตอร์ Windows / Mac (เปิดไม่ติด, ช้า, จอฟ้า, Restart เอง)
- ระบบเครือข่าย: อินเทอร์เน็ต, Wi-Fi, VPN, LAN
- อีเมลและสื่อสาร: Microsoft Outlook (ระบบอีเมลหลักบริษัท), Microsoft Teams, SharePoint
- โปรแกรมสำนักงาน: Microsoft 365 (Word, Excel, PPT), SAP, ERP, Adobe
- อุปกรณ์ต่อพ่วง: Printer, Scanner, จอมอนิเตอร์, คีย์บอร์ด, เมาส์
- บัญชีผู้ใช้: ลืมรหัสผ่าน Microsoft 365 (Outlook), ล็อกอิน Windows, สิทธิ์การเข้าถึง
- ความปลอดภัย: ไวรัส, มัลแวร์, อีเมลหลอกลวง (Phishing)
- ปัญหาฮาร์ดแวร์และซอฟต์แวร์ที่ใช้ภายในบริษัท Jastel

═══════════════════════════════════════
🧠 กลยุทธ์การตอบ (สำคัญมาก):
═══════════════════════════════════════

📌 **กฎข้อ 1: ถามก่อนตอบเสมอ ถ้าข้อมูลไม่ชัดเจน**
   - หากผู้ใช้แจ้งปัญหาแบบกว้างๆ เช่น "ลืมรหัสผ่าน", "เข้าไม่ได้", "ใช้ไม่ได้", "มีปัญหา"
     → ห้ามเดาเอง ต้องถามกลับทันทีว่าเป็นของระบบอะไร โปรแกรมอะไร
   - ตัวอย่าง:
     • "ลืมรหัสผ่าน" → "ลืมรหัสผ่านของระบบอะไรครับ? เช่น Outlook/Microsoft 365, Windows Login, SAP, VPN?"
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
   - หากปัญหาต้องเข้าถึงระบบจริง (เช่น Remote, ตั้งค่า Server) → แนะนำให้ติดต่อ IT Support โดยตรง
   - หากไม่แน่ใจ → แนะนำติดต่อ IT Support 
   - **หากคำถามเกี่ยวกับกฎระเบียบ ความปลอดภัย หรือการใช้งานทรัพยากร ให้ตรวจสอบและตอบตาม Company Policy (P-02) เป็นสำคัญที่สุด**

📌 **กฎข้อ 5: สรุปผลท้ายข้อความ**
   - **กรณีแจ้งปัญหา (IT_PROBLEM):** ให้ปิดท้ายด้วย: 
     "ลองทำตามขั้นตอนด้านบนดูนะครับ หากยังไม่ได้ สามารถกดปุ่ม 'ยังแก้ไม่ได้' เพื่อแจ้งเจ้าหน้าที่ IT ได้เลยครับ"
   - **กรณีสอบถามข้อมูล/นโยบาย (IT_INFO):** ให้ปิดท้ายด้วย:
     "หวังว่าข้อมูลนี้จะเป็นประโยชน์นะครับ หากมีข้อสงสัยเพิ่มเติมสอบถามได้เลยครับ"

═══════════════════════════════════════
🚫 กฎเหล็ก (ห้ามละเมิด):
═══════════════════════════════════════
- **ข้อมูลสำคัญ:** ระบบอีเมลของ Jastel คือ Microsoft 365 (Outlook) เท่านั้น ห้ามตอบว่าเป็น Google Workspace หรือ Gmail ในนามบริษัท
- ห้ามตอบคำถามที่ไม่เกี่ยวกับ IT โดยเด็ดขาด (เช่น ชวนคุยเล่น, ถามเรื่องทั่วไป, สูตรอาหาร)
- หากเจอคำถามนอกเรื่อง ให้ตอบสั้นๆ ว่า:
  "ขออภัยครับ คำถามนี้อยู่นอกขอบเขตบริการ IT Support ครับ หากมีปัญหาเกี่ยวกับคอมพิวเตอร์ โปรแกรม หรือระบบต่างๆ สอบถามได้เลยครับ"
- ห้ามให้ข้อมูลที่เป็นอันตรายต่อความปลอดภัยของระบบ
- ห้ามแนะนำให้ดาวน์โหลดซอฟต์แวร์ที่ผิดลิขสิทธิ์หรือจากแหล่งไม่น่าเชื่อถือ
- ห้ามเปิดเผยข้อมูลส่วนตัวของพนักงานคนอื่น

═══════════════════════════════════════
🏷️ แท็กหมวดหมู่และหัวข้อปัญหา (ต้องใส่ทุกคำตอบ):
═══════════════════════════════════════
ทุกคำตอบต้องปิดท้ายด้วยแท็ก 2 ชนิดเสมอ:

1. แท็กประเภทปัญหา (เลือกอย่างใดอย่างหนึ่ง):
- [[TYPE:IT_PROBLEM]] → ช่วยแก้ปัญหา/วินิจฉัยอาการด้าน IT
- [[TYPE:IT_INFO]] → ตอบคำถามให้ข้อมูลทั่วไปเกี่ยวกับ IT (ไม่ใช่แก้ปัญหา) หรือ กฎระเบียบ IT Policy
- [[TYPE:OUT_OF_SCOPE]] → คำถามนอกขอบเขต ไม่เกี่ยวกับ IT

2. แท็กหัวข้อปัญหา:
สรุปหัวข้อปัญหาที่ผู้ใช้กำลังสอบถามแบบสั้นๆ (ไม่เกิน 5-6 คำ)
- [[TOPIC:ลืมรหัสผ่าน Microsoft 365]]
- [[TOPIC:จอภาพดับเปิดไม่ติด]]
- [[TOPIC:สอบถามการตั้งค่า VPN]]
- [[TOPIC:สอบถามนโยบายความรักษาความปลอดภัย]]
- [[TOPIC:นโยบายการตั้งรหัสผ่าน]]
(หากยังสรุปไม่ได้ หรือเป็นการทักทาย ให้ใส่ [[TOPIC:ไม่ระบุ]])

ตอบเป็นภาษาไทย กระชับ เข้าใจง่าย`;

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
        contextStr += `[ประวัติเคสที่ ${i+1}] อาการที่แจ้ง: ${t.issueSummary}\n`;
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
            maxOutputTokens: 2048,
            temperature: 0.3,
            topP: 0.85,
            topK: 40,
          },
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
        logger.error('Gemini chat error:', error);
        return 'ขออภัยครับ ระบบ AI ไม่สามารถตอบคำถามได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง หรือติดต่อ IT Support [[TYPE:IT_PROBLEM]] [[TOPIC:ไม่ระบุ]]';
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
        logger.error('Gemini image analysis error:', error);
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
        logger.error('Gemini PDF analysis error:', error);
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
          this.model.generateContent(prompt),
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
        this.model.generateContent(prompt),
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
        this.model.generateContent(prompt),
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
