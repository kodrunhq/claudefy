import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConfigManager } from "../../src/config/config-manager.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ConfigManager", () => {
  let tempDir: string;
  let configManager: ConfigManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-test-"));
    configManager = new ConfigManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("initializes config directory and files", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    const config = await configManager.load();
    expect(config.backend.url).toBe("git@github.com:user/store.git");
    expect(config.backend.type).toBe("git");
    expect(config.machineId).toBeTruthy();
  });

  it("generates a unique machine ID", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    const config = await configManager.load();
    expect(config.machineId).toMatch(/^[a-z0-9-]+$/);
  });

  it("loads existing config", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    const config1 = await configManager.load();
    const config2 = await configManager.load();
    expect(config1.machineId).toBe(config2.machineId);
  });

  it("updates config values", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    await configManager.set("encryption.useKeychain", true);
    const config = await configManager.load();
    expect(config.encryption.useKeychain).toBe(true);
  });

  it("manages links", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    await configManager.addLink("kodrun", "/home/user/projects/kodrun", {
      canonicalId: "github.com--kodrunhq--kodrun",
      gitRemote: "git@github.com:kodrunhq/kodrun.git",
    });
    const links = await configManager.getLinks();
    expect(links.kodrun.localPath).toBe("/home/user/projects/kodrun");
    expect(links.kodrun.canonicalId).toBe("github.com--kodrunhq--kodrun");
  });

  it("removes links", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    await configManager.addLink("kodrun", "/home/user/projects/kodrun", {
      canonicalId: "github.com--kodrunhq--kodrun",
      gitRemote: null,
    });
    await configManager.removeLink("kodrun");
    const links = await configManager.getLinks();
    expect(links.kodrun).toBeUndefined();
  });

  it("manages sync filter overrides to allow", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    await configManager.setFilterOverride("get-shit-done", "allow");
    const filter = await configManager.getSyncFilter();
    expect(filter.allowlist).toContain("get-shit-done");
    expect(filter.denylist).not.toContain("get-shit-done");
  });

  it("manages sync filter overrides to deny", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    await configManager.setFilterOverride("some-dir", "deny");
    const filter = await configManager.getSyncFilter();
    expect(filter.denylist).toContain("some-dir");
    expect(filter.allowlist).not.toContain("some-dir");
  });

  it("moves item between tiers on override change", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    await configManager.setFilterOverride("movable", "allow");
    let filter = await configManager.getSyncFilter();
    expect(filter.allowlist).toContain("movable");

    await configManager.setFilterOverride("movable", "deny");
    filter = await configManager.getSyncFilter();
    expect(filter.denylist).toContain("movable");
    expect(filter.allowlist).not.toContain("movable");
  });

  it("throws on initialize when already initialized", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    await expect(
      configManager.initialize("git@github.com:user/other.git")
    ).rejects.toThrow("already initialized");
  });

  it("reports isInitialized correctly", async () => {
    expect(configManager.isInitialized()).toBe(false);
    await configManager.initialize("git@github.com:user/store.git");
    expect(configManager.isInitialized()).toBe(true);
  });

  it("returns config directory path", async () => {
    const dir = configManager.getConfigDir();
    expect(dir).toContain(".claudefy");
  });

  it("throws on set with invalid key path", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    await expect(
      configManager.set("nonexistent.key", "value")
    ).rejects.toThrow('Invalid config key');
  });
});
