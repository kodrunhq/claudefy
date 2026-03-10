import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SecretScanner } from "../../src/secret-scanner/scanner.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("SecretScanner", () => {
  let tempDir: string;
  let scanner: SecretScanner;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-scan-test-"));
    scanner = new SecretScanner();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects API keys in files", async () => {
    const file = join(tempDir, "settings.json");
    await writeFile(
      file,
      JSON.stringify({ apiKey: "sk-ant-api03-reallyLongSecretKeyHere1234567890abcdef" }),
    );

    const results = await scanner.scanFile(file);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBe(file);
  });

  it("detects AWS credentials", async () => {
    const file = join(tempDir, "config.json");
    await writeFile(file, JSON.stringify({ key: "AKIAIOSFODNN7EXAMPLE" }));

    const results = await scanner.scanFile(file);
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns empty for clean files", async () => {
    const file = join(tempDir, "commands.md");
    await writeFile(file, "# My Command\nDo something useful");

    const results = await scanner.scanFile(file);
    expect(results.length).toBe(0);
  });

  it("does not flag long alphanumeric strings or base64 content", async () => {
    const file = join(tempDir, "history.jsonl");
    await writeFile(
      file,
      JSON.stringify({
        id: "a".repeat(64),
        hash: "abc123def456abc123def456abc123def456abc123def456",
        data: "SGVsbG8gV29ybGQgdGhpcyBpcyBhIGxvbmcgYmFzZTY0IHN0cmluZw==",
        path: "/home/user/.claude/projects/-home-user-develop-myproject/settings.json",
      }),
    );
    const results = await scanner.scanFile(file);
    expect(results.length).toBe(0);
  });

  it("does not double-flag Anthropic keys as OpenAI keys", async () => {
    const file = join(tempDir, "config.json");
    await writeFile(
      file,
      JSON.stringify({ key: "sk-ant-api03-reallyLongSecretKeyHere1234567890abcdef" }),
    );
    const results = await scanner.scanFile(file);
    expect(results.length).toBe(1);
    expect(results[0].pattern).toBe("Anthropic API Key");
  });

  it("scans multiple files", async () => {
    const clean = join(tempDir, "clean.md");
    const dirty = join(tempDir, "dirty.json");
    await writeFile(clean, "no secrets here");
    await writeFile(dirty, JSON.stringify({ token: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef12" }));

    const results = await scanner.scanFiles([clean, dirty]);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.file === dirty)).toBe(true);
  });
});
