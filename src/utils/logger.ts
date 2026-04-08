import fs from 'fs';
import path from 'path';

// กำหนด path ของ folder logs โดยให้อยู่ใน root ของ project (ข้างๆ src)
const LOG_DIR = path.join(process.cwd(), 'logs');

// สร้าง folder logs ถ้ายังไม่มี
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

type LogLevel = 'info' | 'error' | 'warn' | 'debug';

// ฟังก์ชันสร้างชื่อไฟล์ log แบบรายวัน (YYYY-MM-DD.log)
function getLogFileName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return path.join(LOG_DIR, `${year}-${month}-${day}.log`);
}

// ฟังก์ชันจัดการ format ข้อความ log
function formatMessage(level: LogLevel, message: string, meta?: any) {
  const now = new Date().toISOString();
  
  // แปลง object meta ให้เป็น string เผื่อมีการส่งค่าตัวแปรหรือ error object เข้ามาเพิ่มเติม
  let metaString = '';
  if (meta !== undefined) {
    if (meta instanceof Error) {
      metaString = ` | Meta: ${meta.stack || meta.message}`;
    } else if (typeof meta === 'object') {
      metaString = ` | Meta: ${JSON.stringify(meta)}`;
    } else {
      metaString = ` | Meta: ${meta}`;
    }
  }

  return `[${now}] [${level.toUpperCase()}]: ${message}${metaString}\n`;
}

// ฟังก์ชันหลักสำหรับเขียน log
export function log(level: LogLevel, message: string, meta?: any) {
  const formattedMessage = formatMessage(level, message, meta);
  const logFile = getLogFileName();
  
  // ปริ้นออก Console ด้วย
  if (level === 'error') {
    console.error(formattedMessage.trim());
  } else if (level === 'warn') {
    console.warn(formattedMessage.trim());
  } else {
    console.log(formattedMessage.trim());
  }

  // เขียนต่อท้ายไฟล์ของวันนั้นๆ
  try {
    fs.appendFileSync(logFile, formattedMessage, 'utf8');
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
}

// export ออกไปให้ใช้ง่ายๆ แบบ object
export const logger = {
  info: (message: string, meta?: any) => log('info', message, meta),
  error: (message: string, meta?: any) => log('error', message, meta),
  warn: (message: string, meta?: any) => log('warn', message, meta),
  debug: (message: string, meta?: any) => log('debug', message, meta),
};
