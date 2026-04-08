import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

let isConnected = false;

export const connectDB = async (): Promise<void> => {
  if (isConnected) {
    logger.info('Already connected to MongoDB');
    return;
  }

  try {
    const db = await mongoose.connect(process.env.MONGODB_URI as string, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    isConnected = db.connections[0].readyState === 1;
    logger.info('Connected to MongoDB Success');
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    throw error;
  }
};

export default connectDB;
