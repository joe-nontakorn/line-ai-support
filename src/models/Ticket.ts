import mongoose, { Schema, Document } from 'mongoose';

export interface ITicket extends Document {
  name: string;
  employeeId: string;
  department: string;
  email: string;
  phone: string;
  issueSummary: string;
  status: number; // 1 = Not resolved (Pending), 0 = Resolved
  reportedAt: Date;
}

const TicketSchema: Schema = new Schema({
  name: { type: String, required: true },
  employeeId: { type: String, required: true },
  department: { type: String, required: true },
  email: { type: String, default: 'ไม่ระบุ' },
  phone: { type: String, default: 'ไม่ระบุ' },
  issueSummary: { type: String, required: true },
  status: { type: Number, default: 1 },
  reportedAt: { type: Date, default: Date.now }
});

export default mongoose.model<ITicket>('Ticket', TicketSchema);
