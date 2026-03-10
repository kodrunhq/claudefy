import { describe, it, expect } from "vitest";
import { LineEncryptor } from "../../src/encryptor/line-encryptor.js";

describe("LineEncryptor", () => {
  const passphrase = "test-passphrase-123";

  describe("encryptLine / decryptLine", () => {
    it("should roundtrip a single line", () => {
      const enc = new LineEncryptor(passphrase);
      const original = '{"key": "value", "count": 42}';
      const encrypted = enc.encryptLine(original);
      const decrypted = enc.decryptLine(encrypted);
      expect(decrypted).toBe(original);
    });

    it("should produce deterministic output (same input = same output)", () => {
      const enc = new LineEncryptor(passphrase);
      const line = "hello world";
      const a = enc.encryptLine(line);
      const b = enc.encryptLine(line);
      expect(a).toBe(b);
    });

    it("should produce different output for different lines", () => {
      const enc = new LineEncryptor(passphrase);
      const a = enc.encryptLine("line one");
      const b = enc.encryptLine("line two");
      expect(a).not.toBe(b);
    });

    it("should handle empty string", () => {
      const enc = new LineEncryptor(passphrase);
      const encrypted = enc.encryptLine("");
      const decrypted = enc.decryptLine(encrypted);
      expect(decrypted).toBe("");
    });

    it("should handle unicode content", () => {
      const enc = new LineEncryptor(passphrase);
      const original = '{"emoji": "🎉🚀", "japanese": "こんにちは", "arabic": "مرحبا"}';
      const encrypted = enc.encryptLine(original);
      const decrypted = enc.decryptLine(encrypted);
      expect(decrypted).toBe(original);
    });

    it("should handle very long lines (10KB+)", () => {
      const enc = new LineEncryptor(passphrase);
      const original = "x".repeat(10240);
      const encrypted = enc.encryptLine(original);
      const decrypted = enc.decryptLine(encrypted);
      expect(decrypted).toBe(original);
    });

    it("should produce base64 encoded output", () => {
      const enc = new LineEncryptor(passphrase);
      const encrypted = enc.encryptLine("test");
      expect(encrypted).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });
  });

  describe("encryptLines / decryptLines", () => {
    it("should roundtrip multiple lines preserving order", () => {
      const enc = new LineEncryptor(passphrase);
      const lines = [
        '{"id": 1, "name": "alice"}',
        '{"id": 2, "name": "bob"}',
        '{"id": 3, "name": "charlie"}',
      ];
      const encrypted = enc.encryptLines(lines);
      expect(encrypted).toHaveLength(3);
      const decrypted = enc.decryptLines(encrypted);
      expect(decrypted).toEqual(lines);
    });

    it("should be deterministic across multiple calls", () => {
      const enc = new LineEncryptor(passphrase);
      const lines = ["line a", "line b", "line c"];
      const first = enc.encryptLines(lines);
      const second = enc.encryptLines(lines);
      expect(first).toEqual(second);
    });

    it("should produce identical output for unchanged lines (incremental append)", () => {
      const enc = new LineEncryptor(passphrase);
      const original = ["line 1", "line 2"];
      const appended = ["line 1", "line 2", "line 3"];
      const encOriginal = enc.encryptLines(original);
      const encAppended = enc.encryptLines(appended);
      // First two lines should be identical
      expect(encAppended[0]).toBe(encOriginal[0]);
      expect(encAppended[1]).toBe(encOriginal[1]);
      // Third line should be new
      expect(encAppended[2]).toBeDefined();
    });

    it("should handle empty array", () => {
      const enc = new LineEncryptor(passphrase);
      expect(enc.encryptLines([])).toEqual([]);
      expect(enc.decryptLines([])).toEqual([]);
    });
  });

  describe("encryptFileContent / decryptFileContent", () => {
    it("should roundtrip file content with trailing newline", () => {
      const enc = new LineEncryptor(passphrase);
      const content = '{"a":1}\n{"b":2}\n{"c":3}\n';
      const encrypted = enc.encryptFileContent(content);
      const decrypted = enc.decryptFileContent(encrypted);
      expect(decrypted).toBe(content);
    });

    it("should handle content without trailing newline", () => {
      const enc = new LineEncryptor(passphrase);
      const content = "line1\nline2";
      const encrypted = enc.encryptFileContent(content);
      // encrypted always ends with newline
      expect(encrypted.endsWith("\n")).toBe(true);
      const decrypted = enc.decryptFileContent(encrypted);
      // decrypted always ends with newline
      expect(decrypted).toBe("line1\nline2\n");
    });

    it("should handle empty file", () => {
      const enc = new LineEncryptor(passphrase);
      expect(enc.encryptFileContent("")).toBe("");
      expect(enc.decryptFileContent("")).toBe("");
    });

    it("should handle whitespace-only content as empty", () => {
      const enc = new LineEncryptor(passphrase);
      expect(enc.decryptFileContent("  \n  \n")).toBe("");
    });

    it("should produce deterministic file content encryption", () => {
      const enc = new LineEncryptor(passphrase);
      const content = "row1\nrow2\nrow3\n";
      const a = enc.encryptFileContent(content);
      const b = enc.encryptFileContent(content);
      expect(a).toBe(b);
    });

    it("should preserve line structure in encrypted output", () => {
      const enc = new LineEncryptor(passphrase);
      const content = "a\nb\nc\n";
      const encrypted = enc.encryptFileContent(content);
      // Should have 3 encrypted lines + trailing newline
      const encLines = encrypted.slice(0, -1).split("\n");
      expect(encLines).toHaveLength(3);
    });
  });

  describe("wrong passphrase", () => {
    it("should throw when decrypting with wrong passphrase", () => {
      const enc1 = new LineEncryptor("correct-passphrase");
      const enc2 = new LineEncryptor("wrong-passphrase");
      const encrypted = enc1.encryptLine("secret data");
      expect(() => enc2.decryptLine(encrypted)).toThrow();
    });

    it("should throw when decrypting file content with wrong passphrase", () => {
      const enc1 = new LineEncryptor("correct-passphrase");
      const enc2 = new LineEncryptor("wrong-passphrase");
      const encrypted = enc1.encryptFileContent("line1\nline2\n");
      expect(() => enc2.decryptFileContent(encrypted)).toThrow();
    });
  });

  describe("constructor determinism", () => {
    it("should produce same results from separate instances with same passphrase", () => {
      const enc1 = new LineEncryptor(passphrase);
      const enc2 = new LineEncryptor(passphrase);
      const line = "test determinism";
      expect(enc1.encryptLine(line)).toBe(enc2.encryptLine(line));
    });
  });
});
