// User.ts
import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  lineUserId: string;
  name: string;
  employeeId: string;
  department: string;
  email?: string;
  phone?: string;
  registeredAt: Date;
  isActive: boolean;
  lastStatusCheck?: Date;
}

const userSchema = new Schema<IUser>({
  lineUserId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  employeeId: {
    type: String,
    required: true
  },
  department: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: false
  },
  phone: {
    type: String,
    required: false
  },
  registeredAt: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastStatusCheck: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

export default mongoose.model<IUser>('User', userSchema);
