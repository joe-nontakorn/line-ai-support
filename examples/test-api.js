#!/usr/bin/env bun

/**
 * ตัวอย่างการเรียกใช้ API
 * วิธีใช้: bun run examples/test-api.js
 */

const API_BASE_URL = 'http://localhost:3000/api';

// สี ANSI สำหรับ console
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
};

async function testAPI() {
  console.log(`${colors.bright}${colors.blue}
╔════════════════════════════════════════╗
║   LINE IT Support Bot - API Tests     ║
╚════════════════════════════════════════╝
${colors.reset}\n`);

  try {
    // Test 1: Get Statistics
    console.log(`${colors.yellow}📊 Testing: GET /api/stats${colors.reset}`);
    const statsRes = await fetch(`${API_BASE_URL}/stats`);
    const stats = await statsRes.json();
    console.log(JSON.stringify(stats, null, 2));
    console.log(`${colors.green}✓ Success\n${colors.reset}`);

    // Test 2: Get Conversations
    console.log(`${colors.yellow}💬 Testing: GET /api/conversations${colors.reset}`);
    const convsRes = await fetch(`${API_BASE_URL}/conversations?limit=5`);
    const convs = await convsRes.json();
    console.log(`Total conversations: ${convs.data.pagination.total}`);
    console.log(`Showing: ${convs.data.conversations.length} items`);
    console.log(`${colors.green}✓ Success\n${colors.reset}`);

    // Test 3: Get Users
    console.log(`${colors.yellow}👥 Testing: GET /api/users${colors.reset}`);
    const usersRes = await fetch(`${API_BASE_URL}/users?limit=5`);
    const users = await usersRes.json();
    console.log(`Total users: ${users.data.pagination.total}`);
    console.log(`Showing: ${users.data.users.length} items`);
    console.log(`${colors.green}✓ Success\n${colors.reset}`);

    // Test 4: Get Common Issues
    console.log(`${colors.yellow}🐛 Testing: GET /api/issues${colors.reset}`);
    const issuesRes = await fetch(`${API_BASE_URL}/issues?limit=5`);
    const issues = await issuesRes.json();
    console.log(`Top issues: ${issues.data.length}`);
    if (issues.data.length > 0) {
      console.log('\nTop 3 Issues:');
      issues.data.slice(0, 3).forEach((issue, i) => {
        console.log(`  ${i + 1}. ${issue.issue}`);
        console.log(`     - Count: ${issue.count}`);
        console.log(`     - Resolution Rate: ${issue.resolutionRate}%`);
        console.log(`     - Avg Rating: ${issue.averageRating || 'N/A'}`);
      });
    }
    console.log(`${colors.green}✓ Success\n${colors.reset}`);

    // Test 5: Get Rating Distribution
    console.log(`${colors.yellow}⭐ Testing: GET /api/ratings${colors.reset}`);
    const ratingsRes = await fetch(`${API_BASE_URL}/ratings`);
    const ratings = await ratingsRes.json();
    console.log('Rating Distribution:');
    ratings.data.forEach(r => {
      const stars = '⭐'.repeat(r.rating);
      const bar = '█'.repeat(Math.floor(r.count / 2));
      console.log(`  ${stars} (${r.rating}): ${bar} ${r.count}`);
    });
    console.log(`${colors.green}✓ Success\n${colors.reset}`);

    console.log(`${colors.bright}${colors.green}
╔════════════════════════════════════════╗
║     All API Tests Passed! ✓            ║
╚════════════════════════════════════════╝
${colors.reset}`);

  } catch (error) {
    console.error(`${colors.red}✗ Error:${colors.reset}`, error.message);
    console.log(`\n${colors.yellow}Make sure the server is running: bun run dev${colors.reset}`);
    process.exit(1);
  }
}

// Run tests
testAPI();
