import { expect, test, describe } from "bun:test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { RegistrationService } from "../src/services/line/registration.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("System Operation Tests", () => {
  
  // 1. ทดสอบการมีอยู่ของไฟล์นโยบาย
  test("Company Policy file should exist and be readable", () => {
    // Path จาก tests/operation.test.ts ไปยัง public/policy.md คือ ../public/policy.md
    const policyPath = path.resolve(__dirname, "../public/policy.md");
    const exists = fs.existsSync(policyPath);
    expect(exists).toBe(true);
    
    if (exists) {
      const stats = fs.statSync(policyPath);
      expect(stats.size).toBeGreaterThan(0); 
    }
  });

  // 2. ทดสอบระบบความจำการลงทะเบียน (Registration State Management)
  test("Registration state should handle set/get correctly", () => {
    const regService = new RegistrationService();
    const mockUserId = "U123456789_TEST_ROOT";
    const mockState: any = { 
      step: 1, 
      tempPayload: { name: "Test User", employeeId: "J001", department: "IT" } 
    };
    
    regService.setState(mockUserId, mockState);
    const retrieved = regService.getState(mockUserId);
    
    expect(retrieved).not.toBeNull();
    expect(retrieved?.step).toBe(1);
    expect(retrieved?.tempPayload?.employeeId).toBe("J001");
  });

  // 3. ทดสอบการเช็คเงื่อนไขหมดอายุของข้อมูล (State Expiry Logic)
  test("Registration state should expire after TTL", () => {
    const regService = new RegistrationService();
    const oneHourAgo = Date.now() - (60 * 60 * 1000); 
    
    // @ts-ignore
    const isExpired = regService.isStateExpired({ updatedAt: oneHourAgo });
    expect(isExpired).toBe(true);
    
    // @ts-ignore
    const isNotExpired = regService.isStateExpired({ updatedAt: Date.now() });
    expect(isNotExpired).toBe(false);
  });
});
