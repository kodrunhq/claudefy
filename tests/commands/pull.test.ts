import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PullCommand } from "../../src/commands/pull.js";
import { PushCommand } from "../../src/commands/push.js";
import { GitAdapter } from "../../src/git-adapter/git-adapter.js";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";
import { existsSync } from "node:fs";

describe("PullCommand", () => {
  let pushHomeDir: string;
  let pullHomeDir: string;
  let remoteDir: string;

  beforeEach(async () => {
    // Machine A: will push content
    pushHomeDir = await mkdtemp(join(tmpdir(), "claudefy-push-home-"));
    // Machine B: will pull content
    pullHomeDir = await mkdtemp(join(tmpdir(), "claudefy-pull-home-"));

    // Create bare remote
    remoteDir = await mkdtemp(join(tmpdir(), "claudefy-remote-"));
    await simpleGit(remoteDir).init(true, ["-b", "main"]);

    // Set up Machine A with content
    const pushClaudeDir = join(pushHomeDir, ".claude");
    const pushClaudefyDir = join(pushHomeDir, ".claudefy");

    await mkdir(join(pushClaudeDir, "commands"), { recursive: true });
    await writeFile(join(pushClaudeDir, "commands", "test.md"), "# Test Command");
    await mkdir(join(pushClaudeDir, "agents"), { recursive: true });
    await writeFile(join(pushClaudeDir, "agents", "my-agent.md"), "# Agent");
    await writeFile(
      join(pushClaudeDir, "settings.json"),
      JSON.stringify({
        theme: "dark",
        hooks: { SessionStart: [] },
      }),
    );

    // Machine A config
    await mkdir(join(pushClaudefyDir, "backups"), { recursive: true });
    await writeFile(
      join(pushClaudefyDir, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: remoteDir },
        encryption: { enabled: false, useKeychain: false, cacheDuration: "0" },
        sync: { lfsThreshold: 512 * 1024 },
        filter: {},
        machineId: "machine-a",
      }),
    );
    await writeFile(join(pushClaudefyDir, "links.json"), "{}");
    await writeFile(
      join(pushClaudefyDir, "sync-filter.json"),
      JSON.stringify({
        allowlist: ["commands", "agents", "settings.json"],
        denylist: ["cache"],
      }),
    );

    // Push from Machine A
    const push = new PushCommand(pushHomeDir);
    await push.execute({ quiet: true, skipEncryption: true });

    // Set up Machine B with minimal config (no content yet)
    const pullClaudeDir = join(pullHomeDir, ".claude");
    const pullClaudefyDir = join(pullHomeDir, ".claudefy");

    await mkdir(pullClaudeDir, { recursive: true });
    await mkdir(join(pullClaudefyDir, "backups"), { recursive: true });
    await writeFile(
      join(pullClaudefyDir, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: remoteDir },
        encryption: { enabled: false, useKeychain: false, cacheDuration: "0" },
        sync: { lfsThreshold: 512 * 1024 },
        filter: {},
        machineId: "machine-b",
      }),
    );
    await writeFile(join(pullClaudefyDir, "links.json"), "{}");
    await writeFile(
      join(pullClaudefyDir, "sync-filter.json"),
      JSON.stringify({
        allowlist: ["commands", "agents", "settings.json"],
        denylist: ["cache"],
      }),
    );
  });

  afterEach(async () => {
    await rm(pushHomeDir, { recursive: true, force: true });
    await rm(pullHomeDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  it("pulls files from remote store to local ~/.claude", async () => {
    const pull = new PullCommand(pullHomeDir);
    const result = await pull.execute({ quiet: true, skipEncryption: true });

    const pullClaudeDir = join(pullHomeDir, ".claude");

    const command = await readFile(join(pullClaudeDir, "commands", "test.md"), "utf-8");
    expect(command).toBe("# Test Command");

    const agent = await readFile(join(pullClaudeDir, "agents", "my-agent.md"), "utf-8");
    expect(agent).toBe("# Agent");

    expect(result.filesUpdated).toBeGreaterThan(0);
    expect(result.overrideDetected).toBe(false);
  });

  it("deep merges settings.json with local", async () => {
    // Machine B has its own settings
    await writeFile(
      join(pullHomeDir, ".claude", "settings.json"),
      JSON.stringify({ theme: "light", editor: "vim" }),
    );

    const pull = new PullCommand(pullHomeDir);
    await pull.execute({ quiet: true, skipEncryption: true });

    const settings = JSON.parse(
      await readFile(join(pullHomeDir, ".claude", "settings.json"), "utf-8"),
    );

    // Remote "dark" theme wins (remote-wins strategy via deepmerge)
    expect(settings.theme).toBe("dark");
    // Local "editor" key preserved
    expect(settings.editor).toBe("vim");
    // Remote hooks are stripped for security (prevents hook injection)
    expect(settings.hooks).toBeUndefined();
  });

  it("detects override marker and creates backup", async () => {
    // Simulate override from Machine A
    const pushClaudefyDir = join(pushHomeDir, ".claudefy");
    const gitAdapter = new GitAdapter(pushClaudefyDir);
    await gitAdapter.initStore(remoteDir);
    await gitAdapter.writeOverrideMarker("machine-a");
    await gitAdapter.commitAndPush("override: machine-a");

    // Machine B has existing content that should be backed up
    await writeFile(
      join(pullHomeDir, ".claude", "settings.json"),
      JSON.stringify({ theme: "light" }),
    );

    const pull = new PullCommand(pullHomeDir);
    const result = await pull.execute({ quiet: true, skipEncryption: true });

    expect(result.overrideDetected).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(existsSync(result.backupPath!)).toBe(true);
  });

  it("handles encrypted files on pull", { timeout: 15_000 }, async () => {
    // Push with encryption from Machine A
    await writeFile(
      join(pushHomeDir, ".claudefy", "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: remoteDir },
        encryption: { enabled: true, useKeychain: false, cacheDuration: "0" },
        sync: { lfsThreshold: 512 * 1024 },
        filter: {},
        machineId: "machine-a",
      }),
    );

    const push = new PushCommand(pushHomeDir);
    await push.execute({ quiet: true, passphrase: "test-secret" });

    // Pull with encryption on Machine B
    await writeFile(
      join(pullHomeDir, ".claudefy", "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: remoteDir },
        encryption: { enabled: true, useKeychain: false, cacheDuration: "0" },
        sync: { lfsThreshold: 512 * 1024 },
        filter: {},
        machineId: "machine-b",
      }),
    );

    const pull = new PullCommand(pullHomeDir);
    await pull.execute({ quiet: true, passphrase: "test-secret" });

    // Verify decrypted content arrived
    const settings = JSON.parse(
      await readFile(join(pullHomeDir, ".claude", "settings.json"), "utf-8"),
    );
    expect(settings.theme).toBe("dark");
  });

  it("updates machine registry last sync time", async () => {
    // First, register machine-b in the registry by doing a push
    const pullClaudefyDir = join(pullHomeDir, ".claudefy");

    // We need machine-b registered first. Push from machine B to register it.
    const pushB = new PushCommand(pullHomeDir);
    await pushB.execute({ quiet: true, skipEncryption: true });

    // Now pull
    const pull = new PullCommand(pullHomeDir);
    await pull.execute({ quiet: true, skipEncryption: true });

    // Verify manifest was updated (machine-b should have a recent lastSync)
    const gitAdapter = new GitAdapter(pullClaudefyDir);
    await gitAdapter.initStore(remoteDir);
    const manifest = JSON.parse(
      await readFile(join(gitAdapter.getStorePath(), "manifest.json"), "utf-8"),
    );

    const machineB = manifest.machines.find((m: any) => m.machineId === "machine-b");
    expect(machineB).toBeDefined();
    expect(machineB.lastSync).toBeDefined();
  });
});
