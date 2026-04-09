import path from 'path';
import os from 'os';
import fs from 'fs';
import { logger } from './logger.js';

/**
 * จัดการเส้นทางในการเก็บไฟล์ อิงตาม OS หรือ Environment Variable
 */
export const getUploadDir = (): string => {
  // อันดับ 1: ใช้จาก Environment Variable (ถ้ามี)
  if (process.env.UPLOAD_DIR) {
    return path.resolve(process.env.UPLOAD_DIR);
  }

  // อันดับ 2: แยกระหว่าง Windows (Local) กับ Linux (Server)
  const isWindows = os.platform() === 'win32';

  if (isWindows) {
    // Local path: ~\Documents\jastel-app\line-it-support-bot\uploads
    return path.join(os.homedir(), 'Documents', 'jastel-app', 'line-it-support-bot', 'uploads');
  } else {
    // Server path (Linux): /var/www/jastel-app/line-ai-support/uploads
    const linuxPath = '/var/www/jastel-app/line-ai-support/uploads';
    return linuxPath;
  }
};

/**
 * ตรวจสอบและสร้างโฟลเดอร์สำหรับเก็บไฟล์
 */
export const ensureUploadDir = (): void => {
  const dir = getUploadDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info(`📁 Created upload directory at: ${dir}`);
  }
};

/**
 * สร้าง Public URL ของไฟล์
 */
export const getFilePublicUrl = (filename: string): string => {
  const baseUrl = process.env.UPLOAD_BASE_URL || 'http://localhost:3002';
  return `${baseUrl}/uploads/${filename}`;
};
