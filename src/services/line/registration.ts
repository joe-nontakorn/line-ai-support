import nodemailer from 'nodemailer';
import dns from 'node:dns';
import User from '../../models/User.js';
import { RegistrationState } from './types.js';
import { REGISTRATION_TTL_MS } from './constants.js';
import { fetchWithTimeout, normalizePhone } from './utils.js';

const registrationStates = new Map<string, RegistrationState>();

export class RegistrationService {
  isStateExpired(state: RegistrationState): boolean {
    return Date.now() - state.updatedAt > REGISTRATION_TTL_MS;
  }

  getState(userId: string): RegistrationState | null {
    const state = registrationStates.get(userId);
    if (!state) return null;

    if (this.isStateExpired(state)) {
      registrationStates.delete(userId);
      return null;
    }

    return state;
  }

  setState(userId: string, state: Omit<RegistrationState, 'updatedAt'>): void {
    registrationStates.set(userId, {
      ...state,
      updatedAt: Date.now(),
    });
  }

  clearState(userId: string): void {
    registrationStates.delete(userId);
  }

  async sendOTPEmail(email: string, otp: string, name: string): Promise<boolean> {
    try {
      const port = parseInt(process.env.SMTP_PORT || '587');
      const secure = process.env.SMTP_SECURE === 'true' && port === 465;

      const transportOptions: any = {
        host: process.env.SMTP_HOST || 'smtp.office365.com',
        port: port,
        secure: secure,
        requireTLS: port === 587,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        tls: {
          rejectUnauthorized: false
        },
        // Force IPv4 if IPv6 is failing in this environment
        family: 4, 
        lookup: (hostname: string, options: any, callback: any) => {
          dns.lookup(hostname, { family: 4 }, (err, address, family) => {
            callback(err, address, family);
          });
        },
        connectionTimeout: 10000, 
        greetingTimeout: 10000,
        socketTimeout: 10000,
      };

      const transporter = nodemailer.createTransport(transportOptions);

      const mailOptions = {
        from: `"IT Support Jastel" <${process.env.SMTP_USER || 'no-reply@jastel.co.th'}>`,
        to: email,
        subject: 'รหัส OTP สำหรับยืนยันตัวตน LINE IT Support Jastel',
        html: `
          <h3>เรียนคุณ ${name},</h3>
          <p>รหัส OTP สำหรับการลงทะเบียนเข้าใช้งานระบบ LINE IT Support Jastel ของคุณคือ: <strong>${otp}</strong></p>
          <p>รหัสจะมีอายุการใช้งาน 5 นาที กรุณานำรหัส 6 หลักนี้ไปกรอกในแชท LINE</p>
          <br>
          <p>หากคุณไม่ได้ทำการลงทะเบียน กรุณาเพิกเฉยต่ออีเมลฉบับนี้</p>
          <p>Best Regards,<br>IT Support Team</p>
        `,
      };

      await transporter.sendMail(mailOptions);
      return true;
    } catch (error) {
      console.error('Error sending OTP email:', error);
      return false;
    }
  }

  async validateEmployee(searchQuery: string): Promise<any | null> {
    const response = await fetchWithTimeout('http://172.16.1.16:3000/api/employees/list', { method: 'GET' }, 15000);
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const jsonResponse: any = await response.json();
    const employees: any[] = Array.isArray(jsonResponse) ? jsonResponse : (jsonResponse.data || []);

    return employees.find((emp: any) => {
      const empId = emp.emp_id ? emp.emp_id.toLowerCase() : '';
      const empEmail = emp.email ? emp.email.toLowerCase() : '';
      return empId === searchQuery || empEmail === searchQuery;
    });
  }

  async checkDuplicateUser(match: any, currentUserId: string): Promise<boolean> {
    // โหมด Dev อนุญาตให้สลับ LINE ID ได้อิสระ (ลบข้อมูลการผูกบัญชีเก่าออกให้เลย)
    if (process.env.NODE_ENV !== 'production') {
       await User.deleteMany({
         $or: [
           { employeeId: match.emp_id },
           { email: match.email && match.email.trim() !== '' ? match.email : 'INVALID_EMAIL_IGNORE' }
         ],
         lineUserId: { $ne: currentUserId }
       });
       return false;
    }

    const existingUser = await User.findOne({ 
      $or: [
        { employeeId: match.emp_id },
        { email: match.email }
      ]
    });
    return !!(existingUser && existingUser.lineUserId !== currentUserId);
  }

  async updateEmployeePhone(employeeId: string, phone: string): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(`http://172.16.1.16:3000/api/employees/update/${encodeURIComponent(employeeId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ phone })
      }, 10000);

      return response.ok;
    } catch (error) {
      console.error('Error updating employee phone:', error);
      return false;
    }
  }
}
