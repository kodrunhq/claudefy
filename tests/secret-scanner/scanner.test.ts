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

  it("detects Google API keys", async () => {
    const file = join(tempDir, "config.json");
    await writeFile(file, JSON.stringify({ key: "AIzaSyA1234567890abcdefghijklmnopqrstuv" }));
    const results = await scanner.scanFile(file);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].pattern).toBe("Google API Key");
  });

  it("detects Slack bot tokens", async () => {
    const file = join(tempDir, "config.json");
    const token = ["xo" + "xb", "123456789012", "123456789012", "abcdefghijklmnopqrstuvwx"].join(
      "-",
    );
    await writeFile(file, JSON.stringify({ token }));
    const results = await scanner.scanFile(file);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.pattern === "Slack Bot Token")).toBe(true);
  });

  it("detects Slack user tokens", async () => {
    const file = join(tempDir, "config.json");
    const token = [
      "xo" + "xp",
      "123456789012",
      "123456789012",
      "123456789012",
      "abcdefghijklmnopqrstuvwx",
    ].join("-");
    await writeFile(file, JSON.stringify({ token }));
    const results = await scanner.scanFile(file);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.pattern === "Slack User Token")).toBe(true);
  });

  it("detects Stripe live keys", async () => {
    const file = join(tempDir, "config.json");
    const key = "s" + "k_live_" + "abcdefghijklmnopqrstuvwx";
    await writeFile(file, JSON.stringify({ key }));
    const results = await scanner.scanFile(file);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].pattern).toBe("Stripe Live Key");
  });

  it("detects Stripe test keys", async () => {
    const file = join(tempDir, "config.json");
    const key = "s" + "k_test_" + "abcdefghijklmnopqrstuvwx";
    await writeFile(file, JSON.stringify({ key }));
    const results = await scanner.scanFile(file);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].pattern).toBe("Stripe Test Key");
  });

  it("detects Azure connection strings", async () => {
    const file = join(tempDir, "config.json");
    await writeFile(file, `AccountKey=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH==`);
    const results = await scanner.scanFile(file);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].pattern).toBe("Azure Connection String");
  });

  it("detects Twilio API keys", async () => {
    const file = join(tempDir, "config.json");
    const key = "S" + "K" + "0123456789abcdef".repeat(2);
    await writeFile(file, JSON.stringify({ key }));
    const results = await scanner.scanFile(file);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].pattern).toBe("Twilio API Key");
  });

  it("detects Datadog API keys", async () => {
    const file = join(tempDir, "config.json");
    await writeFile(file, JSON.stringify({ key: "dd_abcdefghijklmnopqrstuvwxyz012345" }));
    const results = await scanner.scanFile(file);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].pattern).toBe("Datadog API Key");
  });

  it("skips binary files containing null bytes", async () => {
    const file = join(tempDir, "binary.dat");
    // Simulate a git index file: starts with DIRC magic + null bytes
    const buf = Buffer.from([0x44, 0x49, 0x52, 0x43, 0x00, 0x00, 0x00, 0x02]);
    await writeFile(file, buf);
    const results = await scanner.scanFile(file);
    expect(results.length).toBe(0);
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
