import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InitCommand } from "../../src/commands/init.js";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";
import { existsSync } from "node:fs";
import { CLAUDEFY_DIR } from "../../src/config/defaults.js";

describe("InitCommand", () => {
  let homeDir: string;
  let claudeDir: string;
  let remoteDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-init-test-"));
    claudeDir = join(homeDir, ".claude");

    // Create bare remote
    remoteDir = await mkdtemp(join(tmpdir(), "claudefy-init-remote-"));
    await simpleGit(remoteDir).init(true, ["-b", "main"]);

    // Create ~/.claude with test content
    await mkdir(join(claudeDir, "commands"), { recursive: true });
    await writeFile(join(claudeDir, "commands", "test.md"), "# Test");
    await writeFile(join(claudeDir, "settings.json"), '{"key": "value"}');
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  it("initializes claudefy and pushes config", async () => {
    const cmd = new InitCommand(homeDir);
    await cmd.execute({ backend: remoteDir, quiet: true, skipEncryption: true });

    // Check .claudefy was created
    expect(existsSync(join(homeDir, CLAUDEFY_DIR, "config.json"))).toBe(true);

    // Check store has content
    const storePath = join(homeDir, CLAUDEFY_DIR, "store", "config");
    expect(existsSync(storePath)).toBe(true);
  });

  it("throws if already initialized", async () => {
    const cmd = new InitCommand(homeDir);
    await cmd.execute({ backend: remoteDir, quiet: true, skipEncryption: true });

    await expect(
      cmd.execute({ backend: remoteDir, quiet: true, skipEncryption: true }),
    ).rejects.toThrow(/already initialized/);
  });

  it("installs hooks when requested", async () => {
    const cmd = new InitCommand(homeDir);
    await cmd.execute({
      backend: remoteDir,
      quiet: true,
      skipEncryption: true,
      installHooks: true,
    });

    const settings = JSON.parse(await readFile(join(claudeDir, "settings.json"), "utf-8"));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.SessionStart).toBeDefined();
  });

  it("disables encryption in non-TTY without passphrase", async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    try {
      const cmd = new InitCommand(homeDir);
      await cmd.execute({ backend: remoteDir, quiet: true });

      const configPath = join(homeDir, CLAUDEFY_DIR, "config.json");
      const config = JSON.parse(await readFile(configPath, "utf-8"));
      expect(config.encryption.enabled).toBe(false);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    }
  });
});
