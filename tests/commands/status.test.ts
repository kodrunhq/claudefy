import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { StatusCommand } from "../../src/commands/status.js";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CLAUDEFY_DIR } from "../../src/config/defaults.js";

describe("StatusCommand", () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-status-test-"));
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  it("returns initialized=false when not initialized", async () => {
    const cmd = new StatusCommand(homeDir);
    const result = await cmd.execute();
    expect(result.initialized).toBe(false);
  });

  it("returns status when initialized", async () => {
    const claudeDir = join(homeDir, ".claude");
    const claudefyDir = join(homeDir, CLAUDEFY_DIR);

    // Create ~/.claude with test content
    await mkdir(join(claudeDir, "commands"), { recursive: true });
    await writeFile(join(claudeDir, "commands", "test.md"), "# Test");
    await writeFile(join(claudeDir, "settings.json"), '{"key": "value"}');
    await mkdir(join(claudeDir, "cache"), { recursive: true });
    await writeFile(join(claudeDir, "cache", "temp"), "cached");

    // Create config
    await mkdir(claudefyDir, { recursive: true });
    await writeFile(
      join(claudefyDir, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: "https://example.com/repo.git" },
        encryption: { enabled: false, useKeychain: false, cacheDuration: "0" },
        sync: { lfsThreshold: 524288 },
        filter: {},
        machineId: "test-machine",
      }),
    );
    await writeFile(
      join(claudefyDir, "sync-filter.json"),
      JSON.stringify({
        allowlist: ["commands", "settings.json"],
        denylist: ["cache"],
      }),
    );

    const cmd = new StatusCommand(homeDir);
    const result = await cmd.execute();

    expect(result.initialized).toBe(true);
    expect(result.machineId).toBe("test-machine");
    expect(result.syncedFiles).toContain("commands");
    expect(result.syncedFiles).toContain("settings.json");
    expect(result.deniedFiles).toContain("cache");
  });
});
