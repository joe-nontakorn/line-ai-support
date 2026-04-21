import { MAX_LINE_TEXT_LENGTH } from './constants.js';

export function now(): Date {
  return new Date();
}

export function getBangkokDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function sanitizeFreeText(text: string): string {
  return text.replace(/\u0000/g, '').trim();
}

export function truncateText(text: string, maxLength: number = MAX_LINE_TEXT_LENGTH): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 20).trim()}\n\n[ข้อความถูกตัดเพื่อให้ส่งผ่าน LINE ได้]`;
}

export function chunkText(text: string, maxLength: number = MAX_LINE_TEXT_LENGTH): string[] {
  const sanitized = text.trim();
  if (!sanitized) return [''];

  if (sanitized.length <= maxLength) {
    return [sanitized];
  }

  const chunks: string[] = [];
  let remaining = sanitized;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt < maxLength * 0.5) {
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitAt < maxLength * 0.5) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

export function normalizePhone(value: string): string {
  return value.replace(/[^\d+]/g, '');
}

export function isValidPhone(value: string): boolean {
  const normalized = normalizePhone(value);
  return /^(\+?\d{8,15})$/.test(normalized);
}

export function isValidEmployeeId(value: string): boolean {
  return /^[A-Za-z0-9_-]{3,30}$/.test(value.trim());
}

export function isValidName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.length <= 120;
}

export function isValidDepartment(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.length <= 120;
}

export async function streamToBuffer(streamLike: AsyncIterable<Buffer>, maxBytes?: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of streamLike) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalSize += buf.length;
    if (maxBytes && totalSize > maxBytes) {
      throw new Error(`File size exceeds limit of ${maxBytes} bytes`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
