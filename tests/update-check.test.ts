import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { shouldCheck, writeCache, CACHE_FILE, isNewer } from "../src/update-check.js";

describe("update-check", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-update-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates cache file after check", async () => {
    expect(await shouldCheck(tempDir)).toBe(true);
    await writeCache(tempDir, "1.2.0");
    expect(await shouldCheck(tempDir)).toBe(false);
  });

  it("isNewer handles prerelease versions", () => {
    expect(isNewer("1.3.0-beta.1", "1.2.0")).toBe(true);
    expect(isNewer("1.2.0-beta.1", "1.2.0")).toBe(false);
    expect(isNewer("2.0.0-rc.1", "1.9.9")).toBe(true);
  });

  it("rechecks after cache expires", async () => {
    const cachePath = join(tempDir, CACHE_FILE);
    const expired = JSON.stringify({
      lastCheck: Date.now() - 25 * 60 * 60 * 1000,
      latestVersion: "1.1.0",
    });
    await writeFile(cachePath, expired);
    expect(await shouldCheck(tempDir)).toBe(true);
  });
});
