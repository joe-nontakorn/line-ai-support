import 'dotenv/config';
import { RegistrationService } from '../src/services/line/registration.js';

async function test() {
  const service = new RegistrationService();
  console.log('Sending email to nontakorn.k@jastel.co.th...');
  const result = await service.sendOTPEmail('nontakorn.k@jastel.co.th', '123456', 'Nontakorn');
  console.log('Result:', result);
  process.exit(0);
}

test();
