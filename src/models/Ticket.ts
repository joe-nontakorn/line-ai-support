import mongoose, { Schema, Document } from 'mongoose';

// สถานะของ Ticket
export type TicketStatus = 'pending' | 'in_progress' | 'waiting_user_confirm' | 'resolved';

export interface IStatusHistory {
  status: TicketStatus;
  changedAt: Date;
  changedBy?: string; // ชื่อเจ้าหน้าที่ที่เปลี่ยนสถานะ
  comment?: string;   // หมายเหตุเพิ่มเติม
}

export interface ITicket extends Document {
  ticketId: string;
  name: string;
  employeeId: string;
  department: string;
  email: string;
  phone: string;
  issueSummary: string;
  status: TicketStatus;
  statusHistory: IStatusHistory[];
  resolutionComment: string; // วิธีแก้ปัญหา (บังคับเมื่อ status = resolved) — สำหรับ AI วิเคราะห์
  reportedAt: Date;
  acceptedAt?: Date;   // เวลาที่กดรับเรื่อง
  resolvedAt?: Date;   // เวลาที่แก้ไขสำเร็จ
}

const StatusHistorySchema: Schema = new Schema({
  status: { type: String, enum: ['pending', 'in_progress', 'waiting_user_confirm', 'resolved'], required: true },
  changedAt: { type: Date, default: Date.now },
  changedBy: { type: String, default: '' },
  comment: { type: String, default: '' }
}, { _id: false });

const TicketSchema: Schema = new Schema({
  ticketId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  employeeId: { type: String, required: true },
  department: { type: String, required: true },
  email: { type: String, default: 'ไม่ระบุ' },
  phone: { type: String, default: 'ไม่ระบุ' },
  issueSummary: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'in_progress', 'waiting_user_confirm', 'resolved'], 
    default: 'pending' 
  },
  statusHistory: { type: [StatusHistorySchema], default: [] },
  resolutionComment: { type: String, default: '' },
  reportedAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null }
});

// สร้าง Text Index เพื่อให้สามารถใช้ค้นหาเคสเก่าที่คล้ายกันโดยใช้ keyword (RAG System)
TicketSchema.index({ issueSummary: 'text', resolutionComment: 'text' });

export default mongoose.model<ITicket>('Ticket', TicketSchema);
