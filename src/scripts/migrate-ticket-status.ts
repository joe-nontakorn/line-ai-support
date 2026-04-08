/**
 * Migration Script: แปลง ticket status จาก number (0/1) เป็น string ('pending'/'resolved')
 * 
 * Usage: npx tsx src/scripts/migrate-ticket-status.ts
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';
dotenv.config();

async function migrate() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/line-ai-support';
  await mongoose.connect(mongoUri);
  logger.info('Connected to MongoDB');

  const db = mongoose.connection.db;
  if (!db) { logger.error('No db connection'); process.exit(1); }

  const collection = db.collection('tickets');

  // แปลง status: 1 (Pending) → 'pending'
  const pendingResult = await collection.updateMany(
    { status: 1 },
    { 
      $set: { status: 'pending', statusHistory: [], resolutionComment: '' },
    }
  );
  logger.info(`Migrated ${pendingResult.modifiedCount} tickets from status=1 to "pending"`);

  // แปลง status: 0 (Resolved) → 'resolved'
  const resolvedResult = await collection.updateMany(
    { status: 0 },
    { 
      $set: { status: 'resolved', statusHistory: [], resolutionComment: 'ดำเนินการแก้ไขแล้ว (migrated)' },
    }
  );
  logger.info(`Migrated ${resolvedResult.modifiedCount} tickets from status=0 to "resolved"`);

  // เพิ่ม field ใหม่ให้ ticket ที่ยังไม่มี
  const addFieldsResult = await collection.updateMany(
    { statusHistory: { $exists: false } },
    { 
      $set: { statusHistory: [], resolutionComment: '' }
    }
  );
  logger.info(`Added new fields to ${addFieldsResult.modifiedCount} tickets`);

  logger.info('Migration completed!');
  await mongoose.disconnect();
}

migrate().catch(err => {
  logger.error('Migration failed:', err);
  process.exit(1);
});
