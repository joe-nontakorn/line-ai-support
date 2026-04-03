export const REGISTRATION_TTL_MS = 30 * 60 * 1000;
export const MAX_LINE_TEXT_LENGTH = 4500;
export const LOADING_SECONDS = 20;

export const SUPPORT_COMMANDS = new Set([
  'ยังแก้ไม่ได้',
  'ติดต่อเจ้าหน้าที่',
  'เริ่มสนทนาใหม่',
  '/start',
  '/help',
  'ช่วยเหลือ',
  'แก้ได้แล้ว',
]);

export const GREETING_KEYWORDS = [
  'hi',
  'hello',
  'สวัสดี',
  'สวัสดีครับ',
  'สวัสดีค่ะ',
  'ดีจ้า',
  'ดีครับ',
  'ดีค่ะ',
  'ทัก',
  'ดีค้าบ',
  'สวัสดีค้าบ',
  'หวัดดี',
];

export const ESCALATE_KEYWORDS = [
  'ติดต่อเจ้าหน้าที่',
  'escalate',
  'ติดต่อit',
  'ติดต่อ it',
  'เรียกit',
  'เรียก it',
  'คุยกับคน',
  'คุยกับเจ้าหน้าที่',
  'แจ้งit',
  'แจ้ง it',
  'เรียกแอดมิน',
  'เรียก admin',
];
