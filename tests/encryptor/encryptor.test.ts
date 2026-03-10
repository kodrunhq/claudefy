import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Encryptor } from "../../src/encryptor/encryptor.js";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Encryptor", () => {
  let tempDir: string;
  const passphrase = "test-passphrase-123";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-enc-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("encrypts and decrypts a file", { timeout: 15_000 }, async () => {
    const encryptor = new Encryptor(passphrase);
    const srcPath = join(tempDir, "test.json");
    const encPath = join(tempDir, "test.json.age");
    const decPath = join(tempDir, "test-dec.json");

    await writeFile(srcPath, '{"key": "secret-value"}');

    await encryptor.encryptFile(srcPath, encPath);
    const encrypted = await readFile(encPath);
    expect(encrypted.toString()).not.toContain("secret-value");

    await encryptor.decryptFile(encPath, decPath);
    const decrypted = await readFile(decPath, "utf-8");
    expect(decrypted).toBe('{"key": "secret-value"}');
  });

  it("encrypts and decrypts a string", async () => {
    const encryptor = new Encryptor(passphrase);
    const original = "sensitive data here";

    const encrypted = await encryptor.encryptString(original);
    expect(encrypted).not.toContain("sensitive");

    const decrypted = await encryptor.decryptString(encrypted);
    expect(decrypted).toBe(original);
  });

  it("fails decryption with wrong passphrase", async () => {
    const encryptor1 = new Encryptor("correct-passphrase");
    const encryptor2 = new Encryptor("wrong-passphrase");

    const encrypted = await encryptor1.encryptString("secret");
    await expect(encryptor2.decryptString(encrypted)).rejects.toThrow();
  });
});
