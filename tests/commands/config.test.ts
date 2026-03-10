import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConfigCommand } from "../../src/commands/config.js";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ConfigCommand", () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-config-test-"));
    const claudefyDir = join(homeDir, ".claudefy");
    await mkdir(claudefyDir, { recursive: true });
    await writeFile(
      join(claudefyDir, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: "https://example.com/repo.git" },
        encryption: { enabled: true, useKeychain: false, cacheDuration: "0" },
        sync: { lfsThreshold: 524288 },
        filter: {},
        machineId: "test-machine",
      }),
    );
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  it("gets full config", async () => {
    const cmd = new ConfigCommand(homeDir);
    const result = await cmd.get();
    expect(result.version).toBe(1);
    expect(result.machineId).toBe("test-machine");
  });

  it("gets a specific key", async () => {
    const cmd = new ConfigCommand(homeDir);
    const result = await cmd.get("encryption.enabled");
    expect(result).toBe(true);
  });

  it("gets a nested key", async () => {
    const cmd = new ConfigCommand(homeDir);
    const result = await cmd.get("backend.url");
    expect(result).toBe("https://example.com/repo.git");
  });

  it("throws for invalid key path", async () => {
    const cmd = new ConfigCommand(homeDir);
    await expect(cmd.get("nonexistent.key")).rejects.toThrow(/Invalid config key/);
  });

  it("sets a value", async () => {
    const cmd = new ConfigCommand(homeDir);
    await cmd.set("encryption.enabled", false);
    const result = await cmd.get("encryption.enabled");
    expect(result).toBe(false);
  });

  it("throws when not initialized", async () => {
    const emptyHome = await mkdtemp(join(tmpdir(), "claudefy-config-empty-"));
    const cmd = new ConfigCommand(emptyHome);
    await expect(cmd.get()).rejects.toThrow(/not initialized/);
    await rm(emptyHome, { recursive: true, force: true });
  });
});
