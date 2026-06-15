import crypto from 'crypto';
import { logger } from '../utils/logger.js';

const ENCRYPTION_KEY = process.env.CONFIG_ENCRYPTION_KEY || 'default-unsafe-key-change-this-12345678';

// ตรวจสอบว่า key มีความยาว 64 hex characters (32 bytes)
if (ENCRYPTION_KEY.length !== 64) {
  logger.warn(
    `[Crypto] CONFIG_ENCRYPTION_KEY length is ${ENCRYPTION_KEY.length}, expected 64 hex characters (32 bytes). ` +
    `Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  );
}

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; // AES block size

export function encrypt(text: string): string {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf-8', 'hex');
    encrypted += cipher.final('hex');

    // Return IV:encrypted
    return `${iv.toString('hex')}:${encrypted}`;
  } catch (error) {
    logger.error('[Crypto] Encryption failed:', error);
    throw new Error('Failed to encrypt data');
  }
}

export function decrypt(encryptedText: string): string {
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted text format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');

    return decrypted;
  } catch (error) {
    logger.error('[Crypto] Decryption failed:', error);
    throw new Error('Failed to decrypt data');
  }
}

export function maskKey(key: string, visibleChars: number = 4): string {
  if (key.length <= visibleChars) return '*'.repeat(key.length);
  const visible = key.slice(-visibleChars);
  // Limit to 40 chars total for display
  const totalMask = Math.min(8, key.length - visibleChars) + visibleChars;
  return '*'.repeat(totalMask - visibleChars) + visible;
}
