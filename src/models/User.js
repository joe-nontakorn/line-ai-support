import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
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

export default mongoose.model('User', userSchema);
