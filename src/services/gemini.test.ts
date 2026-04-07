
import { expect, test, describe } from "bun:test";
import geminiService from "./gemini.js";

describe("GeminiService", () => {
  describe("parseResponse", () => {
    test("should correctly parse a response with TYPE and TOPIC", () => {
      const rawResponse = "สวัสดีครับ ผมช่วยเรื่องนี้ได้ครับ [[TYPE:IT_PROBLEM]] [[TOPIC:ลืมรหัสผ่าน]]";
      const result = geminiService.parseResponse(rawResponse);

      expect(result.content).toBe("สวัสดีครับ ผมช่วยเรื่องนี้ได้ครับ");
      expect(result.type).toBe("IT_PROBLEM");
      expect(result.topic).toBe("ลืมรหัสผ่าน");
    });

    test("should handle missing TOPIC", () => {
      const rawResponse = "คำถามนี้นอกขอบเขตครับ [[TYPE:OUT_OF_SCOPE]]";
      const result = geminiService.parseResponse(rawResponse);

      expect(result.content).toBe("คำถามนี้นอกขอบเขตครับ");
      expect(result.type).toBe("OUT_OF_SCOPE");
      expect(result.topic).toBeUndefined();
    });

    test("should handle missing TYPE (default to IT_PROBLEM)", () => {
      const rawResponse = "คำตอบที่ไม่มีแท็ก";
      const result = geminiService.parseResponse(rawResponse);

      expect(result.content).toBe("คำตอบที่ไม่มีแท็ก");
      expect(result.type).toBe("IT_PROBLEM");
    });

    test("should provide fallback content if response is empty", () => {
      const result = geminiService.parseResponse("");
      expect(result.content).toBe("ขออภัยครับ ไม่สามารถสร้างคำตอบได้ในขณะนี้");
    });
  });
});
