import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
    await simpleGit(remoteDir).init(true, ["-b", "main"]);

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

  it("decrypts files when passphrase is provided via options", async () => {
    // Re-initialize Machine A with encryption enabled
    await rm(join(initHomeDir, ".claudefy"), { recursive: true, force: true });

    // Create a file with a secret to trigger encryption
    const claudeDir = join(initHomeDir, ".claude");
    await mkdir(join(claudeDir, "projects"), { recursive: true });
    await writeFile(
      join(claudeDir, "projects", "session.jsonl"),
      '{"prompt":"test","apiKey":"sk-ant-api03-secret123"}\n',
    );

    const encInitHome = await mkdtemp(join(tmpdir(), "claudefy-join-enc-init-"));
    extraDirs.push(encInitHome);
    const encClaudeDir = join(encInitHome, ".claude");
    await mkdir(join(encClaudeDir, "projects"), { recursive: true });
    await writeFile(
      join(encClaudeDir, "projects", "session.jsonl"),
      '{"prompt":"test","apiKey":"sk-ant-api03-secret123"}\n',
    );
    await writeFile(join(encClaudeDir, "settings.json"), '{"theme":"dark"}');

    const encRemote = await mkdtemp(join(tmpdir(), "claudefy-join-enc-remote-"));
    extraDirs.push(encRemote);
    await simpleGit(encRemote).init(true, ["-b", "main"]);

    const initCmd = new InitCommand(encInitHome);
    await initCmd.execute({
      backend: encRemote,
      quiet: true,
      passphrase: "test-join-pass",
    });

    // Verify the remote has .age files
    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-join-enc-verify-"));
    extraDirs.push(verifyDir);
    await simpleGit(verifyDir).clone(encRemote, "store");
    expect(existsSync(join(verifyDir, "store", "config", "projects", "session.jsonl.age"))).toBe(
      true,
    );

    // Machine B joins with the passphrase provided directly
    const encJoinHome = await mkdtemp(join(tmpdir(), "claudefy-join-enc-join-"));
    extraDirs.push(encJoinHome);
    const encJoinClaudeDir = join(encJoinHome, ".claude");
    await mkdir(encJoinClaudeDir, { recursive: true });
    await writeFile(join(encJoinClaudeDir, "settings.json"), "{}");

    const joinCmd = new JoinCommand(encJoinHome);
    await joinCmd.execute({
      backend: encRemote,
      quiet: true,
      passphrase: "test-join-pass",
    });

    // The decrypted content should be present locally
    const sessionPath = join(encJoinHome, ".claude", "projects", "session.jsonl");
    expect(existsSync(sessionPath)).toBe(true);
    const content = await readFile(sessionPath, "utf-8");
    expect(content).toContain("sk-ant-api03-secret123");
  });

  it("fails when store has encrypted files and no passphrase is available (non-TTY)", async () => {
    // Initialize with encryption
    const encInitHome = await mkdtemp(join(tmpdir(), "claudefy-join-enc2-init-"));
    extraDirs.push(encInitHome);
    const encClaudeDir = join(encInitHome, ".claude");
    await mkdir(join(encClaudeDir, "projects"), { recursive: true });
    await writeFile(
      join(encClaudeDir, "projects", "session.jsonl"),
      '{"apiKey":"sk-ant-api03-secret"}\n',
    );
    await writeFile(join(encClaudeDir, "settings.json"), "{}");

    const encRemote = await mkdtemp(join(tmpdir(), "claudefy-join-enc2-remote-"));
    extraDirs.push(encRemote);
    await simpleGit(encRemote).init(true, ["-b", "main"]);

    const initCmd = new InitCommand(encInitHome);
    await initCmd.execute({
      backend: encRemote,
      quiet: true,
      passphrase: "test-pass",
    });

    // Join without passphrase on non-TTY (process.stdin.isTTY is undefined in tests)
    const encJoinHome = await mkdtemp(join(tmpdir(), "claudefy-join-enc2-join-"));
    extraDirs.push(encJoinHome);
    await mkdir(join(encJoinHome, ".claude"), { recursive: true });
    await writeFile(join(encJoinHome, ".claude", "settings.json"), "{}");

    const joinCmd = new JoinCommand(encJoinHome);
    await expect(
      joinCmd.execute({
        backend: encRemote,
        quiet: true,
        // no passphrase, no TTY -> should fail in pull
      }),
    ).rejects.toThrow(/Encrypted files found but no passphrase/);
  });

  it("prompts for passphrase when store has .age files and stdin is TTY", async () => {
    // Initialize with encryption
    const encInitHome = await mkdtemp(join(tmpdir(), "claudefy-join-enc3-init-"));
    extraDirs.push(encInitHome);
    const encClaudeDir = join(encInitHome, ".claude");
    await mkdir(join(encClaudeDir, "projects"), { recursive: true });
    await writeFile(
      join(encClaudeDir, "projects", "session.jsonl"),
      '{"apiKey":"sk-ant-api03-secret"}\n',
    );
    await writeFile(join(encClaudeDir, "settings.json"), "{}");

    const encRemote = await mkdtemp(join(tmpdir(), "claudefy-join-enc3-remote-"));
    extraDirs.push(encRemote);
    await simpleGit(encRemote).init(true, ["-b", "main"]);

    const initCmd = new InitCommand(encInitHome);
    await initCmd.execute({
      backend: encRemote,
      quiet: true,
      passphrase: "test-pass",
    });

    // Mock promptExistingPassphrase to return the passphrase
    const passphraseMod = await import("../../src/encryptor/passphrase.js");
    const promptSpy = vi
      .spyOn(passphraseMod, "promptExistingPassphrase")
      .mockResolvedValue({ passphrase: "test-pass", storedInKeychain: false });

    // Mock process.stdin.isTTY
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });

    try {
      const encJoinHome = await mkdtemp(join(tmpdir(), "claudefy-join-enc3-join-"));
      extraDirs.push(encJoinHome);
      await mkdir(join(encJoinHome, ".claude"), { recursive: true });
      await writeFile(join(encJoinHome, ".claude", "settings.json"), "{}");

      const joinCmd = new JoinCommand(encJoinHome);
      await joinCmd.execute({
        backend: encRemote,
        quiet: true,
        // no passphrase — should trigger prompt
      });

      expect(promptSpy).toHaveBeenCalledOnce();

      // Decrypted content should be present
      const sessionPath = join(encJoinHome, ".claude", "projects", "session.jsonl");
      expect(existsSync(sessionPath)).toBe(true);
      const content = await readFile(sessionPath, "utf-8");
      expect(content).toContain("sk-ant-api03-secret");
    } finally {
      promptSpy.mockRestore();
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true });
    }
  });
});
