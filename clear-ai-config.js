import mongoose from 'mongoose';

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/line-it-support';

async function clearOldConfig() {
  try {
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const hasCollection = collections.some(c => c.name === 'aiprovidercconfigs');

    if (hasCollection) {
      const result = await db.collection('aiproviderconfigs').deleteMany({});
      console.log(`🗑️  Deleted ${result.deletedCount} old AI configurations`);
    } else {
      console.log('ℹ️  Collection aiproviderconfigs does not exist yet');
    }

    await mongoose.disconnect();
    console.log('✅ Done! Now run: bun run dev');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

clearOldConfig();
