import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Encryptor } from "../../src/encryptor/encryptor.js";
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

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

  it("encrypts and decrypts a directory recursively", { timeout: 15_000 }, async () => {
    const encryptor = new Encryptor(passphrase);
    const subDir = join(tempDir, "sub");
    await mkdir(subDir, { recursive: true });
    await writeFile(join(tempDir, "a.txt"), "file-a");
    await writeFile(join(subDir, "b.txt"), "file-b");

    await encryptor.encryptDirectory(tempDir);

    // Plaintext files should be replaced with .age files
    expect(existsSync(join(tempDir, "a.txt"))).toBe(false);
    expect(existsSync(join(tempDir, "a.txt.age"))).toBe(true);
    expect(existsSync(join(subDir, "b.txt"))).toBe(false);
    expect(existsSync(join(subDir, "b.txt.age"))).toBe(true);

    await encryptor.decryptDirectory(tempDir);

    // .age files should be replaced with plaintext
    expect(existsSync(join(tempDir, "a.txt.age"))).toBe(false);
    expect(await readFile(join(tempDir, "a.txt"), "utf-8")).toBe("file-a");
    expect(existsSync(join(subDir, "b.txt.age"))).toBe(false);
    expect(await readFile(join(subDir, "b.txt"), "utf-8")).toBe("file-b");
  });

  it("skips symlinks in directory encryption/decryption", { timeout: 15_000 }, async () => {
    const encryptor = new Encryptor(passphrase);
    await writeFile(join(tempDir, "real.txt"), "real-content");
    await symlink(join(tempDir, "real.txt"), join(tempDir, "link.txt"));

    await encryptor.encryptDirectory(tempDir);

    // real.txt should be encrypted, symlink should be untouched
    expect(existsSync(join(tempDir, "real.txt.age"))).toBe(true);
    expect(existsSync(join(tempDir, "real.txt"))).toBe(false);
    // Symlink target is gone, but the symlink entry itself should still exist
    const entries = await readdir(tempDir);
    expect(entries).not.toContain("link.txt.age");
  });
});
