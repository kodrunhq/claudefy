import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConfigManager } from "../../src/config/config-manager.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
    expect(config.machineId).toMatch(/^[a-z0-9._-]+$/);
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

  it("throws on initialize when already initialized", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    await expect(configManager.initialize("git@github.com:user/other.git")).rejects.toThrow(
      "already initialized",
    );
  });

  it("reports isInitialized correctly", async () => {
    expect(configManager.isInitialized()).toBe(false);
    await configManager.initialize("git@github.com:user/store.git");
    expect(configManager.isInitialized()).toBe(true);
  });

  it("throws on set with invalid key path", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    await expect(configManager.set("nonexistent.key", "value")).rejects.toThrow(
      "Invalid config key",
    );
  });

  it("throws when loading config with missing backend", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    // Overwrite config with invalid content missing backend
    const configDir = join(tempDir, ".claudefy");
    await writeFile(
      join(configDir, "config.json"),
      JSON.stringify({ version: 1, machineId: "test-id" }, null, 2),
    );
    await expect(configManager.load()).rejects.toThrow(/missing.*backend/i);
  });

  it("throws when loading config with missing machineId", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    const configDir = join(tempDir, ".claudefy");
    await writeFile(
      join(configDir, "config.json"),
      JSON.stringify(
        { version: 1, backend: { type: "git", url: "git@github.com:x/y.git" } },
        null,
        2,
      ),
    );
    await expect(configManager.load()).rejects.toThrow(/missing.*machineId/i);
  });

  it("rejects prototype pollution keys", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    await expect(configManager.set("__proto__.polluted", "true")).rejects.toThrow(
      "Forbidden config key segment",
    );
    await expect(configManager.set("constructor.polluted", "true")).rejects.toThrow(
      "Forbidden config key segment",
    );
    await expect(configManager.set("prototype.polluted", "true")).rejects.toThrow(
      "Forbidden config key segment",
    );
  });
});
