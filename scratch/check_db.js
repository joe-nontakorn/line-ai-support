import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Ticket from '../src/models/Ticket.js';

dotenv.config();

async function checkVPN() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const count = await Ticket.countDocuments({ 
        $or: [
            { issueSummary: /VPN/i },
            { resolutionComment: /VPN/i }
        ]
    });
    console.log('VPN Tickets found:', count);
    
    if (count > 0) {
        const samples = await Ticket.find({ 
            $or: [
                { issueSummary: /VPN/i },
                { resolutionComment: /VPN/i }
            ]
        }).limit(2);
        console.log('Sample IDs:', samples.map(s => s.ticketId));
    }
    
    await mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}

checkVPN();
