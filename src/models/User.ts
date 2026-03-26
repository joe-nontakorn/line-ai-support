import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  lineUserId: string;
  name: string;
  employeeId: string;
  department: string;
  registeredAt: Date;
  isActive: boolean;
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
  registeredAt: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

export default mongoose.model<IUser>('User', userSchema);
