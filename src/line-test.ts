import axios from 'axios';
import * as dotenv from 'dotenv';
import path from 'path';
import { logger } from './utils/logger.js';

dotenv.config({ path: '/var/www/jastel-app/line-ai-support/.env' });

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const to = 'Cab29e1a8611c54a10098d44edca74eab';

async function testPush() {
  try {
    const res = await axios.post(
      'https://api.line.me/v2/bot/message/push',
      {
        to: to,
        messages: [
          {
            type: 'text',
            text: 'Test message to group'
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }
    );
    logger.info('Success:', res.data);
  } catch (error: any) {
    if (error.response) {
      logger.error('Error Response Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      logger.error('Error:', error.message);
    }
  }
}

testPush();
