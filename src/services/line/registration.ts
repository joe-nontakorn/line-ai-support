// src/services/line/registration.ts
import nodemailer from 'nodemailer';
import dns from 'node:dns';
import path from 'path';
import User from '../../models/User.js';
import { RegistrationState } from './types.js';
import { REGISTRATION_TTL_MS, OTP_EXPIRY_MINUTES } from './constants.js';
import { fetchWithTimeout, normalizePhone } from './utils.js';
import { logger } from '../../utils/logger.js';

const registrationStates = new Map<string, RegistrationState>();

const apiAsset = process.env.API_ASSET;

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
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f1f5f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
            <tr>
              <td align="center" style="padding: 40px 10px;">
                <!-- Main Container Table -->
                <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 24px;">
                  <tr>
                    <td align="center" style="padding: 40px;">
                      
                      <!-- JasTel Branding -->
                      <div style="text-align: center; margin-bottom: 40px;">
                        <div style="display: inline-block;">
                          <span style="font-size: 42px; font-weight: 900; color: #F97316; letter-spacing: -1px;">Jas</span><span style="font-size: 42px; font-weight: 900; color: #0369A1; letter-spacing: -1px;">Tel</span>
                        </div>
                        <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 4px; color: #64748b; margin-top: 8px; font-weight: 600;">Jastel AI IT Support</div>
                      </div>

                      <div style="text-align: center; margin-bottom: 32px;">
                        <h2 style="color: #0f172a; margin: 0; font-size: 24px; font-weight: 800;">🔑 Login Verification / รหัสยืนยันเข้าสู่ระบบ</h2>
                      </div>

                      <div style="margin-bottom: 32px; text-align: center;">
                        <p style="font-weight: 600; margin-bottom: 12px; font-size: 16px; color: #1e293b;">สวัสดีคุณ ${name},</p>
                        <p style="margin: 0; line-height: 1.6; color: #475569;">รหัสยืนยัน (OTP) ของคุณคือ:</p>
                      </div>

                      <!-- OTP Box Table -->
                      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 32px 0;">
                        <tr>
                          <td align="center" style="background-color: #f8fafc; padding: 40px; border-radius: 20px; border: 2px solid #e2e8f0;">
                            <div style="font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 16px; font-weight: 700;">Your Security Code / รหัสความปลอดภัยของคุณ</div>
                            <div style="font-family: 'Monaco', 'Consolas', monospace; font-size: 38px; font-weight: 900; letter-spacing: 8px; color: #0369A1;">${otp.split('').join(' ')}</div>
                          </td>
                        </tr>
                      </table>
                      
                      <div style="margin-bottom: 40px; text-align: center;">
                        <p style="margin-bottom: 8px; line-height: 1.6; font-size: 14px; color: #64748b;">⚠️ รหัสนี้จะหมดอายุภายใน ${OTP_EXPIRY_MINUTES} นาที</p>
                        <p style="margin: 0; line-height: 1.6; font-size: 14px; color: #64748b;">⚠️ This code will expire in ${OTP_EXPIRY_MINUTES} minutes.</p>
                      </div>

                      <!-- Alert Box Table -->
                      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #fff7ed; border-left: 4px solid #f97316; margin-bottom: 40px;">
                        <tr>
                          <td align="left" style="padding: 20px;">
                            <p style="margin: 0; font-size: 13px; color: #9a3412; line-height: 1.6;">
                              หากคุณไม่ได้เป็นผู้ร้องขอรหัสนี้ โปรดเพิกเฉยต่ออีเมลฉบับนี้เพื่อความปลอดภัยของบัญชีของคุณ<br/>
                              If you did not request this code, please ignore this email for your account security.
                            </p>
                          </td>
                        </tr>
                      </table>
                      
                      <hr style="margin: 40px 0; border: 0; border-top: 1px solid #e2e8f0;" />
                      <div style="text-align: center; color: #94a3b8; font-size: 12px; line-height: 1.6; font-weight: 500;">
                        <p style="margin-bottom: 4px;">&copy; ${new Date().getFullYear()} JasTel Network Co., Ltd. All rights reserved.</p>
                        <p style="margin: 0;">This is an automated message, please do not reply.</p>
                      </div>

                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        `,
        attachments: [
          {
            filename: 'jastel.jpg',
            path: path.join(process.cwd(), 'public', 'jastel.jpg'),
            cid: 'jastel_logo'
          }
        ]
      };

      await transporter.sendMail(mailOptions);
      return true;
    } catch (error) {
      logger.error('Error sending OTP email:', error);
      return false;
    }
  }

  async validateEmployee(searchQuery: string): Promise<any | null> {
    const response = await fetchWithTimeout(`${apiAsset}/employees/list`, { method: 'GET' }, 15000);
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

  async updateEmployeePhone(employeeId: string, phone: string, email?: string): Promise<boolean> {
    try {
      // 📡 ใช้ Partial Update ตามที่ Backend รองรับใหม่ โดยส่งแค่ฟิลด์ที่จำเป็น (emp_id, email, phone)
      const payload: any = { emp_id: employeeId, phone };
      if (email) payload.email = email;

      const response = await fetchWithTimeout(`${apiAsset}/employees/update/${encodeURIComponent(employeeId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }, 10000);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`❌ Partial update failed for ${employeeId}:`, { status: response.status, error: errorText });
      }

      return response.ok;
    } catch (error) {
      logger.error('Error in partial updateEmployeePhone:', error);
      return false;
    }
  }
}
