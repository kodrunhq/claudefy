import { describe, it, expect } from "vitest";
import { FileEncryptor } from "../../src/encryptor/file-encryptor.js";

describe("FileEncryptor", () => {
  const passphrase = "test-passphrase-123";

  it("encrypts and decrypts binary content roundtrip", () => {
    const encryptor = new FileEncryptor(passphrase);
    const original = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);

    const encrypted = encryptor.encrypt(original);
    const decrypted = encryptor.decrypt(encrypted);

    expect(decrypted).toEqual(original);
  });

  it("encrypts and decrypts string content roundtrip", () => {
    const encryptor = new FileEncryptor(passphrase);
    const original = "Hello, world! This is a secret message.";

    const encrypted = encryptor.encryptString(original);
    const decrypted = encryptor.decryptString(encrypted);

    expect(decrypted).toBe(original);
  });

  it("produces deterministic output (same input = same output)", () => {
    const encryptor = new FileEncryptor(passphrase);
    const text = "deterministic test content";

    const encrypted1 = encryptor.encryptString(text);
    const encrypted2 = encryptor.encryptString(text);

    expect(encrypted1).toBe(encrypted2);
  });

  it("produces deterministic output across separate instances with same passphrase", () => {
    const enc1 = new FileEncryptor(passphrase);
    const enc2 = new FileEncryptor(passphrase);
    const text = "cross-instance determinism";

    expect(enc1.encryptString(text)).toBe(enc2.encryptString(text));
  });

  it("produces different output for different content", () => {
    const encryptor = new FileEncryptor(passphrase);

    const encrypted1 = encryptor.encryptString("content A");
    const encrypted2 = encryptor.encryptString("content B");

    expect(encrypted1).not.toBe(encrypted2);
  });

  it("handles empty string content", () => {
    const encryptor = new FileEncryptor(passphrase);

    const encrypted = encryptor.encryptString("");
    expect(encrypted).toBe("");

    const decrypted = encryptor.decryptString("");
    expect(decrypted).toBe("");
  });

  it("handles large content (1MB)", () => {
    const encryptor = new FileEncryptor(passphrase);
    const large = new Uint8Array(1024 * 1024);
    for (let i = 0; i < large.length; i++) {
      large[i] = i % 256;
    }

    const encrypted = encryptor.encrypt(large);
    const decrypted = encryptor.decrypt(encrypted);

    expect(decrypted).toEqual(large);
  });

  it("throws error when decrypting with wrong passphrase", () => {
    const encryptor = new FileEncryptor(passphrase);
    const wrongEncryptor = new FileEncryptor("wrong-passphrase");

    const encrypted = encryptor.encryptString("secret data");

    expect(() => wrongEncryptor.decryptString(encrypted)).toThrow();
  });

  it("encrypted output is valid base64", () => {
    const encryptor = new FileEncryptor(passphrase);
    const encrypted = encryptor.encryptString("test content");

    expect(() => Buffer.from(encrypted, "base64")).not.toThrow();
    // Re-encoding should match (valid base64 roundtrip)
    const decoded = Buffer.from(encrypted, "base64");
    expect(decoded.toString("base64")).toBe(encrypted);
  });

  it("encrypted output differs from plaintext", () => {
    const encryptor = new FileEncryptor(passphrase);
    const plaintext = "this should not appear in output";

    const encrypted = encryptor.encryptString(plaintext);

    expect(encrypted).not.toContain(plaintext);
  });

  it("handles unicode content", () => {
    const encryptor = new FileEncryptor(passphrase);
    const unicode = "Hello \u4e16\u754c \ud83c\udf0d \u00e9\u00e0\u00fc\u00f1";

    const encrypted = encryptor.encryptString(unicode);
    const decrypted = encryptor.decryptString(encrypted);

    expect(decrypted).toBe(unicode);
  });
});
