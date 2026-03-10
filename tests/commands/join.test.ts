import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { JoinCommand } from "../../src/commands/join.js";
import { InitCommand } from "../../src/commands/init.js";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";
import { existsSync } from "node:fs";

describe("JoinCommand", () => {
  let initHomeDir: string;
  let joinHomeDir: string;
  let remoteDir: string;
  const extraDirs: string[] = [];

  beforeEach(async () => {
    // Machine A: initializes the store
    initHomeDir = await mkdtemp(join(tmpdir(), "claudefy-join-init-"));
    // Machine B: joins the store
    joinHomeDir = await mkdtemp(join(tmpdir(), "claudefy-join-home-"));

    // Create bare remote
    remoteDir = await mkdtemp(join(tmpdir(), "claudefy-join-remote-"));
    await simpleGit(remoteDir).init(true);

    // Set up Machine A with some claude content
    const claudeDir = join(initHomeDir, ".claude");
    await mkdir(join(claudeDir, "commands"), { recursive: true });
    await writeFile(join(claudeDir, "commands", "test.md"), "# Test Command");
    await writeFile(join(claudeDir, "settings.json"), '{"theme": "dark"}');

    // Initialize from Machine A so the remote has content
    const initCmd = new InitCommand(initHomeDir);
    await initCmd.execute({ backend: remoteDir, quiet: true, skipEncryption: true });

    // Set up Machine B with a minimal ~/.claude directory
    const joinClaudeDir = join(joinHomeDir, ".claude");
    await mkdir(joinClaudeDir, { recursive: true });
    await writeFile(join(joinClaudeDir, "settings.json"), '{"editor": "vim"}');
  });

  afterEach(async () => {
    await rm(initHomeDir, { recursive: true, force: true });
    await rm(joinHomeDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
    for (const dir of extraDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    extraDirs.length = 0;
  });

  it("successfully joins and syncs config from remote", async () => {
    const cmd = new JoinCommand(joinHomeDir);
    await cmd.execute({
      backend: remoteDir,
      quiet: true,
      skipEncryption: true,
    });

    // Config should exist
    expect(existsSync(join(joinHomeDir, ".claudefy", "config.json"))).toBe(true);

    // Machine should be registered in manifest
    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-join-verify-"));
    extraDirs.push(verifyDir);
    await simpleGit(verifyDir).clone(remoteDir, "store");
    const manifest = JSON.parse(await readFile(join(verifyDir, "store", "manifest.json"), "utf-8"));
    // Should have at least 2 machines (init machine + join machine)
    expect(manifest.machines.length).toBeGreaterThanOrEqual(2);
  });

  it("throws when already initialized", async () => {
    const cmd = new JoinCommand(joinHomeDir);
    await cmd.execute({
      backend: remoteDir,
      quiet: true,
      skipEncryption: true,
    });

    // Try to join again
    const cmd2 = new JoinCommand(joinHomeDir);
    await expect(
      cmd2.execute({
        backend: remoteDir,
        quiet: true,
        skipEncryption: true,
      }),
    ).rejects.toThrow(/already initialized/);
  });

  it("installs hooks when requested", async () => {
    const cmd = new JoinCommand(joinHomeDir);
    await cmd.execute({
      backend: remoteDir,
      quiet: true,
      skipEncryption: true,
      installHooks: true,
    });

    const settings = JSON.parse(
      await readFile(join(joinHomeDir, ".claude", "settings.json"), "utf-8"),
    );
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.SessionStart).toBeDefined();
    expect(settings.hooks.SessionEnd).toBeDefined();
  });
});
