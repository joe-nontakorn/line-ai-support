import mongoose from 'mongoose';

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/line-it-support';

async function listCollections() {
  try {
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();

    console.log('\n📋 Collections in database:');
    collections.forEach((c, i) => {
      console.log(`${i + 1}. ${c.name}`);
    });

    // Try to delete from all config-like collections
    for (const collection of collections) {
      if (collection.name.includes('config') || collection.name.includes('provider')) {
        console.log(`\n🗑️  Clearing ${collection.name}...`);
        const result = await db.collection(collection.name).deleteMany({});
        console.log(`   Deleted ${result.deletedCount} documents`);
      }
    }

    await mongoose.disconnect();
    console.log('\n✅ Done!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

listCollections();
