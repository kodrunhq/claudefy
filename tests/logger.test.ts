import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Logger, LogEntry } from "../src/logger.js";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

describe("Logger", () => {
  let logDir: string;
  let logFile: string;
  let logger: Logger;

  beforeEach(async () => {
    logDir = await mkdtemp(join(tmpdir(), "claudefy-logger-test-"));
    logFile = join(logDir, "sync.log");
    logger = new Logger(logFile);
  });

  afterEach(async () => {
    await rm(logDir, { recursive: true, force: true });
  });

  it("creates log file on first write", async () => {
    await logger.log("info", "push", "started");
    expect(existsSync(logFile)).toBe(true);
  });

  it("writes structured log entries", async () => {
    await logger.log("info", "push", "Push complete");
    const content = await readFile(logFile, "utf-8");
    const entry: LogEntry = JSON.parse(content.trim());
    expect(entry.level).toBe("info");
    expect(entry.operation).toBe("push");
    expect(entry.message).toBe("Push complete");
    expect(entry.timestamp).toBeDefined();
  });

  it("appends multiple entries", async () => {
    await logger.log("info", "push", "started");
    await logger.log("info", "push", "complete");
    const content = await readFile(logFile, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("rotates when file exceeds maxBytes", async () => {
    const smallLogger = new Logger(logFile, { maxBytes: 200 });
    for (let i = 0; i < 20; i++) {
      await smallLogger.log("info", "push", `entry ${i}`);
    }
    const stats = await stat(logFile);
    expect(stats.size).toBeLessThan(400);
    expect(existsSync(logFile + ".1")).toBe(true);
  });

  it("keeps at most maxFiles rotated files", async () => {
    const smallLogger = new Logger(logFile, { maxBytes: 100, maxFiles: 2 });
    for (let i = 0; i < 50; i++) {
      await smallLogger.log("info", "push", `entry ${i}`);
    }
    expect(existsSync(logFile + ".1")).toBe(true);
    expect(existsSync(logFile + ".2")).toBe(true);
    expect(existsSync(logFile + ".3")).toBe(false);
  });

  it("readRecent returns last N entries", async () => {
    for (let i = 0; i < 5; i++) {
      await logger.log("info", "push", `entry ${i}`);
    }
    const recent = await logger.readRecent(3);
    expect(recent).toHaveLength(3);
    expect(recent[0].message).toBe("entry 2");
    expect(recent[2].message).toBe("entry 4");
  });

  it("readRecent returns empty array when no log file", async () => {
    const noFileLogger = new Logger(join(logDir, "missing.log"));
    const recent = await noFileLogger.readRecent(10);
    expect(recent).toHaveLength(0);
  });

  it("readRecent filters by level", async () => {
    await logger.log("info", "push", "ok");
    await logger.log("error", "push", "failed");
    await logger.log("info", "pull", "ok");
    const errors = await logger.readRecent(10, { level: "error" });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("failed");
  });

  it("readRecent filters by operation", async () => {
    await logger.log("info", "push", "ok");
    await logger.log("info", "pull", "ok");
    const pulls = await logger.readRecent(10, { operation: "pull" });
    expect(pulls).toHaveLength(1);
    expect(pulls[0].operation).toBe("pull");
  });

  it("survives concurrent writes without corruption", async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      logger.log("info", "push", `concurrent ${i}`),
    );
    await Promise.all(promises);
    const content = await readFile(logFile, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(10);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
