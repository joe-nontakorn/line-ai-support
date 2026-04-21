// src/services/line/handlers/registration.ts
import { MessageAPIResponseBase } from '@line/bot-sdk';
import { MessagingService } from '../messaging.js';
import { RegistrationService } from '../registration.js';
import { ConversationService } from '../conversation.js';
import { normalizePhone } from '../utils.js';
import { logger } from '../../../utils/logger.js';

export async function handleRegistration(
  replyToken: string,
  userId: string,
  text: string,
  messaging: MessagingService,
  registration: RegistrationService,
  conversation: ConversationService
): Promise<MessageAPIResponseBase | undefined> {
  let state = registration.getState(userId);

  if (!state) {
    registration.setState(userId, { step: 1 });
    return messaging.replyText(
      replyToken,
      'สวัสดีครับ! ฉันคือ AI ด้าน IT Support ของบริษัท Jastel Network ยินดีให้บริการครับ 👋\n\n' +
      '⚠️ ประกาศสำคัญก่อนใช้งาน:\n' +
      '- ระบบนี้ออกแบบมาเพื่อตรวจสอบสิทธิ์ผ่านฐานข้อมูลพนักงานบริษัท\n' +
      '- การสนทนาจะถูกบันทึกเพื่อนำไปปรับปรุงระบบและให้บริการในภายหลัง\n' +
      '- รบกวนสอบถามเฉพาะปัญหาที่เกี่ยวข้องกับงานด้าน IT Support เท่านั้น\n\n' +
      'กรุณาลงทะเบียนเพื่อเริ่มใช้งาน โดยใส่รหัสพนักงาน เช่น **1234** หรือ **Email** อย่างใดอย่างหนึ่ง เพื่อให้ระบบตรวจสอบครับ:'
    );
  }

  if (state.step === 1) {
    const searchQuery = text.toLowerCase().trim();
    try {
      await messaging.showLoadingAnimation(userId, 10);
      const match = await registration.validateEmployee(searchQuery);

      if (match) {
        if (!match.email) {
          return messaging.replyText(replyToken, '❌ ไม่พบข้อมูล Email ในระบบพนักงานของคุณ ทำให้ไม่สามารถส่งรหัส OTP ได้ กรุณาติดต่อฝ่าย IT Support เพื่อดำเนินการครับ');
        }

        const isDuplicate = await registration.checkDuplicateUser(match, userId);
        if (isDuplicate) {
          return messaging.replyText(replyToken, '❌ ข้อมูลรหัสพนักงานหรือ Email นี้ ถูกนำไปลงทะเบียนเชื่อมโยงกับ LINE ID อื่นแล้ว หากมีข้อผิดพลาดกรุณาติดต่อฝ่าย IT Support ครับ');
        }

        const payload = {
          name: match.full_name || 'ไม่ระบุชื่อ',
          employeeId: match.emp_id || 'ไม่ระบุรหัสพนักงาน',
          department: match.department_name || match.division_name || 'ไม่ระบุแผนก',
          email: match.email,
          phone: match.phone ? normalizePhone(match.phone) : undefined,
        };

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const emailSuccess = await registration.sendOTPEmail(match.email, otp, match.full_name || 'พนักงาน');

        if (!emailSuccess) {
          return messaging.replyText(replyToken, '❌ ไม่สามารถส่งรหัส OTP ไปยังอีเมลของคุณได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง หรือติดต่อ IT Support เพื่อให้แอดมินตรวจสอบครับ');
        }

        registration.setState(userId, {
          step: 2,
          otp,
          otpExpiresAt: Date.now() + 5 * 60 * 1000,
          tempPayload: payload,
        });

        return messaging.replyText(
          replyToken,
          `✉️ ระบบได้ส่งรหัส OTP 6 หลักไปที่อีเมล **${match.email}** เรียบร้อยแล้ว\n\nกรุณานำรหัส OTP มาพิมพ์ตอบกลับภายใน 5 นาทีครับ\n\n(หากต้องการยกเลิก ให้พิมพ์ "ยกเลิก")`
        );
      } else {
        return messaging.replyText(
          replyToken,
          '❌ ขออภัย ไม่พบข้อมูลของคุณในระบบของบริษัทครับ\n\nกรุณาลองตรวจสอบและค้นหาอีกครั้ง โดยพิมพ์ **รหัสพนักงาน** หรือ **Email** สำหรับยืนยันตัวตนให้ถูกต้องครับ'
        );
      }
    } catch (error) {
      logger.error('API validation error:', error);
      return messaging.replyText(replyToken, 'ระบบตรวจสอบข้อมูลขัดข้อง กรุณาลองใหม่อีกครั้งในภายหลังครับ');
    }
  }

  if (state.step === 2) {
    if (text.trim() === 'ยกเลิก') {
      registration.clearState(userId);
      return messaging.replyText(replyToken, 'ยกเลิกการลงทะเบียนแล้วครับ หากต้องการเริ่มใหม่ ให้พิมพ์ รหัสพนักงาน หรือ Email อีกครั้งเพื่อลงทะเบียนครับ');
    }

    if (!state.otp || !state.otpExpiresAt || !state.tempPayload) {
      registration.setState(userId, { step: 1 });
      return messaging.replyText(replyToken, 'เซสชั่นการลงทะเบียนหมดอายุหรือไม่ถูกต้อง กรุณาเริ่มพิมพ์ รหัสพนักงาน หรือ Email ใหม่อีกครั้งครับ');
    }

    if (Date.now() > state.otpExpiresAt) {
      registration.setState(userId, { step: 1 });
      return messaging.replyText(replyToken, '❌ รหัส OTP หมดอายุการใช้งานแล้ว (เกิน 5 นาที) กรุณาเริ่มพิมพ์ รหัสพนักงาน หรือ Email ใหม่อีกครั้งครับ');
    }

    if (text.trim() !== state.otp) {
      return messaging.replyText(replyToken, '❌ รหัส OTP ไม่ถูกต้อง กรุณาตรวจสอบแล้วลองพิมพ์ใหม่อีกครั้ง (หรือพิมพ์ "ยกเลิก" เพื่อทำรายการใหม่)');
    }

    // 📱 Check if phone is missing
    if (!state.tempPayload.phone) {
      registration.setState(userId, {
        ...state,
        step: 3
      });
      return messaging.replyText(
        replyToken,
        '✅ ยืนยันรหัส OTP สำเร็จครับ\n\nแต่ในระบบยังไม่มีข้อมูล **เบอร์โทรศัพท์** ของคุณ\nกรุณาพิมพ์เบอร์โทรศัพท์เพื่อใช้ในการติดต่อกลับครับ (เช่น 0812345678):'
      );
    }

    await conversation.saveOrUpdateUser(userId, state.tempPayload);
    registration.clearState(userId);

    const contactInfo = `ชื่อ: ${state.tempPayload.name}\nรหัสพนักงาน: ${state.tempPayload.employeeId}\nแผนก: ${state.tempPayload.department}${state.tempPayload.email ? `\nEmail: ${state.tempPayload.email}` : ''}${state.tempPayload.phone ? `\nเบอร์ติดต่อ: ${state.tempPayload.phone}` : ''}`;

    return messaging.replyTextWithQuickReply(
      replyToken,
      `ลงทะเบียนสำเร็จ! ✅ ยืนยันตัวตนผ่าน OTP เรียบร้อยครับ\n\n${contactInfo}\n\nพิมพ์คำถามหรือปัญหาที่ต้องการความช่วยเหลือได้เลยครับ 😊\n\nหรือพิมพ์ /help เพื่อดูคำแนะนำ`,
      [{ label: '👤 ติดต่อเจ้าหน้าที่', text: 'ติดต่อเจ้าหน้าที่' }],
    );
  }

  if (state.step === 3) {
    if (text.trim() === 'ยกเลิก') {
      registration.clearState(userId);
      return messaging.replyText(replyToken, 'ยกเลิกการลงทะเบียนแล้วครับ');
    }

    if (!state.tempPayload) {
      registration.setState(userId, { step: 1 });
      return messaging.replyText(replyToken, 'เซสชั่นการลงทะเบียนไม่ถูกต้อง กรุณาเริ่มใหม่ครับ');
    }

    const phone = normalizePhone(text.trim());
    if (phone.length < 9 || isNaN(Number(phone))) {
      return messaging.replyText(replyToken, '❌ รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง กรุณาระบุรหัส 9-10 หลัก (เช่น 0812345678) ครับ:');
    }

    // Update payload
    state.tempPayload.phone = phone;

    // 📡 Update backend API (Partial Update)
    const updateResult = await registration.updateEmployeePhone(
      state.tempPayload.employeeId,
      phone,
      state.tempPayload.email
    );
    if (updateResult) {
      logger.info(`✅ Successfully updated phone for employee ${state.tempPayload.employeeId} in external database`);
    } else {
      logger.error(`❌ Failed to update phone for employee ${state.tempPayload.employeeId} in external database (Check API logs)`);
    }

    // 💾 Save to local DB (Always save local even if external fails so user can still chat)
    await conversation.saveOrUpdateUser(userId, state.tempPayload);
    registration.clearState(userId);

    const contactInfo = `ชื่อ: ${state.tempPayload.name}\nรหัสพนักงาน: ${state.tempPayload.employeeId}\nแผนก: ${state.tempPayload.department}\nEmail: ${state.tempPayload.email || 'ไม่ระบุ'}\nเบอร์ติดต่อ: ${phone}`;

    return messaging.replyTextWithQuickReply(
      replyToken,
      `ลงทะเบียนสำเร็จ! ✅ ระบบได้บันทึกข้อมูลและเบอร์โทรศัพท์ของคุณเรียบร้อยแล้วครับ\n\n${contactInfo}\n\nพิมพ์คำถามหรือปัญหาที่ต้องการความช่วยเหลือได้เลยครับ 😊`,
      [{ label: '👤 ติดต่อเจ้าหน้าที่', text: 'ติดต่อเจ้าหน้าที่' }],
    );
  }
}
