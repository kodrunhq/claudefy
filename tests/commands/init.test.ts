import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InitCommand } from "../../src/commands/init.js";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";
import { existsSync } from "node:fs";

describe("InitCommand", () => {
  let homeDir: string;
  let claudeDir: string;
  let remoteDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-init-test-"));
    claudeDir = join(homeDir, ".claude");

    // Create bare remote
    remoteDir = await mkdtemp(join(tmpdir(), "claudefy-init-remote-"));
    await simpleGit(remoteDir).init(true);

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
    expect(existsSync(join(homeDir, ".claudefy", "config.json"))).toBe(true);

    // Check store has content
    const storePath = join(homeDir, ".claudefy", "store", "config");
    expect(existsSync(storePath)).toBe(true);
  });

  it("throws if already initialized", async () => {
    const cmd = new InitCommand(homeDir);
    await cmd.execute({ backend: remoteDir, quiet: true, skipEncryption: true });

    await expect(cmd.execute({ backend: remoteDir, quiet: true, skipEncryption: true }))
      .rejects.toThrow(/already initialized/);
  });

  it("installs hooks when requested", async () => {
    const cmd = new InitCommand(homeDir);
    await cmd.execute({ backend: remoteDir, quiet: true, skipEncryption: true, installHooks: true });

    const settings = JSON.parse(await readFile(join(claudeDir, "settings.json"), "utf-8"));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.SessionStart).toBeDefined();
  });
});
