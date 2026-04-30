import mongoose, { Schema, Document } from 'mongoose';

export type NotificationType = "new_user" | "resolved_ticket" | "new_ticket";

export interface INotification extends Document {
  type: NotificationType;
  title: string;
  content: string;
  timestamp: Date;
  isRead: boolean;
  metadata?: any;
}

const NotificationSchema: Schema = new Schema({
  type: { type: String, enum: ["new_user", "resolved_ticket", "new_ticket"], required: true },
  title: { type: String, required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  isRead: { type: Boolean, default: false },
  metadata: { type: Schema.Types.Mixed }
});

// Index for fast sorting by timestamp
NotificationSchema.index({ timestamp: -1 });

export default mongoose.model<INotification>('Notification', NotificationSchema);
