import { describe, it, expect } from "vitest";
import { FileEncryptor } from "../../src/encryptor/file-encryptor.js";

describe("FileEncryptor", () => {
  const passphrase = "test-passphrase-123";

  it("encrypts and decrypts binary content roundtrip", () => {
    const encryptor = new FileEncryptor(passphrase, "test-repo");
    const original = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);

    const encrypted = encryptor.encrypt(original, "test-file");
    const decrypted = encryptor.decrypt(encrypted, "test-file");

    expect(decrypted).toEqual(original);
  });

  it("encrypts and decrypts string content roundtrip", () => {
    const encryptor = new FileEncryptor(passphrase, "test-repo");
    const original = "Hello, world! This is a secret message.";

    const encrypted = encryptor.encryptString(original, "test-file");
    const decrypted = encryptor.decryptString(encrypted, "test-file");

    expect(decrypted).toBe(original);
  });

  it("produces deterministic output (same input = same output)", () => {
    const encryptor = new FileEncryptor(passphrase, "test-repo");
    const text = "deterministic test content";

    const encrypted1 = encryptor.encryptString(text, "test-file");
    const encrypted2 = encryptor.encryptString(text, "test-file");

    expect(encrypted1).toBe(encrypted2);
  });

  it("produces deterministic output across separate instances with same passphrase", () => {
    const enc1 = new FileEncryptor(passphrase, "test-repo");
    const enc2 = new FileEncryptor(passphrase, "test-repo");
    const text = "cross-instance determinism";

    expect(enc1.encryptString(text, "test-file")).toBe(enc2.encryptString(text, "test-file"));
  });

  it("produces different output for different content", () => {
    const encryptor = new FileEncryptor(passphrase, "test-repo");

    const encrypted1 = encryptor.encryptString("content A", "test-file");
    const encrypted2 = encryptor.encryptString("content B", "test-file");

    expect(encrypted1).not.toBe(encrypted2);
  });

  it("handles empty string content", () => {
    const encryptor = new FileEncryptor(passphrase, "test-repo");

    const encrypted = encryptor.encryptString("", "test-file");
    expect(encrypted).toBe("");

    const decrypted = encryptor.decryptString("", "test-file");
    expect(decrypted).toBe("");
  });

  it("handles large content (1MB)", () => {
    const encryptor = new FileEncryptor(passphrase, "test-repo");
    const large = new Uint8Array(1024 * 1024);
    for (let i = 0; i < large.length; i++) {
      large[i] = i % 256;
    }

    const encrypted = encryptor.encrypt(large, "test-file");
    const decrypted = encryptor.decrypt(encrypted, "test-file");

    expect(decrypted).toEqual(large);
  });

  it("throws error when decrypting with wrong passphrase", () => {
    const encryptor = new FileEncryptor(passphrase, "test-repo");
    const wrongEncryptor = new FileEncryptor("wrong-passphrase", "test-repo");

    const encrypted = encryptor.encryptString("secret data", "test-file");

    expect(() => wrongEncryptor.decryptString(encrypted, "test-file")).toThrow();
  });

  it("encrypted output is valid base64", () => {
    const encryptor = new FileEncryptor(passphrase, "test-repo");
    const encrypted = encryptor.encryptString("test content", "test-file");

    expect(() => Buffer.from(encrypted, "base64")).not.toThrow();
    // Re-encoding should match (valid base64 roundtrip)
    const decoded = Buffer.from(encrypted, "base64");
    expect(decoded.toString("base64")).toBe(encrypted);
  });

  it("encrypted output differs from plaintext", () => {
    const encryptor = new FileEncryptor(passphrase, "test-repo");
    const plaintext = "this should not appear in output";

    const encrypted = encryptor.encryptString(plaintext, "test-file");

    expect(encrypted).not.toContain(plaintext);
  });

  it("handles unicode content", () => {
    const encryptor = new FileEncryptor(passphrase, "test-repo");
    const unicode = "Hello \u4e16\u754c \ud83c\udf0d \u00e9\u00e0\u00fc\u00f1";

    const encrypted = encryptor.encryptString(unicode, "test-file");
    const decrypted = encryptor.decryptString(encrypted, "test-file");

    expect(decrypted).toBe(unicode);
  });

  it("produces different ciphertext for different associated data", () => {
    const encryptor = new FileEncryptor(passphrase, "test-repo");
    const data = new TextEncoder().encode("same content");
    const encrypted1 = encryptor.encrypt(data, "config/file-a.json");
    const encrypted2 = encryptor.encrypt(data, "config/file-b.json");
    expect(encrypted1).not.toBe(encrypted2);
  });

  it("fails to decrypt with wrong associated data", () => {
    const encryptor = new FileEncryptor(passphrase, "test-repo");
    const data = new TextEncoder().encode("secret");
    const encrypted = encryptor.encrypt(data, "config/real-path.json");
    expect(() => encryptor.decrypt(encrypted, "config/swapped-path.json")).toThrow();
  });
});
