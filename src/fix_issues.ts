// fix_issues.ts
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env
dotenv.config({ path: resolve(__dirname, '../.env') });

// Minimum Conversation Schema
const conversationSchema = new mongoose.Schema({
  issue: String,
});
const Conversation = mongoose.model('Conversation', conversationSchema);

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/jastel-line-bot');
  console.log('Connected to MongoDB');

  const convs = await Conversation.find({ issue: { $regex: /^ปิดเคสสำเร็จ: IT-/ } });
  console.log(`Found ${convs.length} corrupted issues.`);

  const Ticket = mongoose.models.Ticket || mongoose.model('Ticket', new mongoose.Schema({ ticketId: String, issueSummary: String }));

  for (const conv of convs) {
    if (!conv.issue) continue;
    const ticketId = conv.issue.replace('ปิดเคสสำเร็จ: ', '').trim();
    const ticket = await Ticket.findOne({ ticketId });
    if (ticket) {
      conv.issue = ticket.issueSummary.split('\n')[0];
      await conv.save();
      console.log(`Fixed ${ticketId} -> ${conv.issue}`);
    } else {
      console.log(`Ticket ${ticketId} not found, could not fix.`);
    }
  }

  // Also fix any issues that have newlines (hardware details)
  const convs2 = await Conversation.find({ issue: { $regex: /\n💻/ } });
  console.log(`Found ${convs2.length} issues with hardware details.`);
  for (const conv of convs2) {
    if (!conv.issue) continue;
    conv.issue = conv.issue.split('\n')[0];
    await conv.save();
    console.log(`Fixed formatting -> ${conv.issue}`);
  }

  console.log('Done!');
  process.exit(0);
}

run();
