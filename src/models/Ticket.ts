import mongoose, { Schema, Document } from 'mongoose';

// สถานะของ Ticket
export type TicketStatus = 'pending' | 'in_progress' | 'waiting_user_confirm' | 'resolved';

export interface ITicketAttachment {
  url: string;
  type: 'image' | 'file';
  filename?: string;
}

export interface IStatusHistory {
  status: TicketStatus;
  changedAt: Date;
  changedBy?: string; // ชื่อเจ้าหน้าที่ที่เปลี่ยนสถานะ
  comment?: string;   // หมายเหตุเพิ่มเติม
  attachments?: ITicketAttachment[]; // ไฟล์แนบในแต่ละขั้นตอน
}

export interface ITicket extends Document {
  ticketId: string;
  name: string;
  employeeId: string;
  department: string;
  email: string;
  phone: string;
  issueSummary: string;
  category: string;    // หมวดหมู่หลัก (เช่น Network, Hardware, Software)
  subCategory: string; // หมวดหมู่ย่อย (เช่น VPN, Printer, SAP)
  status: TicketStatus;
  statusHistory: IStatusHistory[];
  resolutionComment: string; // วิธีแก้ปัญหา (บังคับเมื่อ status = resolved) — สำหรับ AI วิเคราะห์
  attachments: ITicketAttachment[]; // ไฟล์แนบโดยรวมของเคส
  reportedAt: Date;
  acceptedAt?: Date;   // เวลาที่กดรับเรื่อง
  resolvedAt?: Date;   // เวลาที่แก้ไขสำเร็จ
}

const AttachmentSchema: Schema = new Schema({
  url: { type: String, required: true },
  type: { type: String, enum: ['image', 'file'], required: true },
  filename: { type: String }
}, { _id: false });

const StatusHistorySchema: Schema = new Schema({
  status: { type: String, enum: ['pending', 'in_progress', 'waiting_user_confirm', 'resolved'], required: true },
  changedAt: { type: Date, default: Date.now },
  changedBy: { type: String, default: '' },
  comment: { type: String, default: '' },
  attachments: { type: [AttachmentSchema], default: [] }
}, { _id: false });

const TicketSchema: Schema = new Schema({
  ticketId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  employeeId: { type: String, required: true },
  department: { type: String, required: true },
  email: { type: String, default: 'ไม่ระบุ' },
  phone: { type: String, default: 'ไม่ระบุ' },
  issueSummary: { type: String, required: true },
  category: { type: String, default: 'Uncategorized' },
  subCategory: { type: String, default: 'Other' },
  status: { 
    type: String, 
    enum: ['pending', 'in_progress', 'waiting_user_confirm', 'resolved'], 
    default: 'pending' 
  },
  statusHistory: { type: [StatusHistorySchema], default: [] },
  resolutionComment: { type: String, default: '' },
  attachments: { type: [AttachmentSchema], default: [] },
  reportedAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null }
});

// สร้าง Text Index เพื่อให้สามารถใช้ค้นหาเคสเก่าที่คล้ายกันโดยใช้ keyword (RAG System)
TicketSchema.index({ issueSummary: 'text', resolutionComment: 'text' });

export default mongoose.model<ITicket>('Ticket', TicketSchema);
