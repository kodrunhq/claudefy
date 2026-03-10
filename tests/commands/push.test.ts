import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PushCommand } from "../../src/commands/push.js";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";
import { existsSync } from "node:fs";

describe("PushCommand", () => {
  let homeDir: string;
  let claudeDir: string;
  let claudefyDir: string;
  let remoteDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-push-test-"));
    claudeDir = join(homeDir, ".claude");
    claudefyDir = join(homeDir, ".claudefy");

    // Create bare remote
    remoteDir = await mkdtemp(join(tmpdir(), "claudefy-push-remote-"));
    await simpleGit(remoteDir).init(true, ["-b", "main"]);

    // Create ~/.claude with test content
    await mkdir(join(claudeDir, "commands"), { recursive: true });
    await writeFile(join(claudeDir, "commands", "test.md"), "# Test Command");
    await mkdir(join(claudeDir, "agents"), { recursive: true });
    await writeFile(join(claudeDir, "agents", "my-agent.md"), "# Agent");
    await writeFile(join(claudeDir, "settings.json"), '{"key": "value"}');

    // Create denylisted items (should not be synced)
    await mkdir(join(claudeDir, "cache"), { recursive: true });
    await writeFile(join(claudeDir, "cache", "temp.dat"), "cached");

    // Create unknown items (should be synced)
    await mkdir(join(claudeDir, "get-shit-done"), { recursive: true });
    await writeFile(join(claudeDir, "get-shit-done", "VERSION"), "1.0.0");

    // Initialize claudefy config
    await mkdir(join(claudefyDir, "backups"), { recursive: true });
    await writeFile(
      join(claudefyDir, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: remoteDir },
        encryption: { enabled: false, useKeychain: false, cacheDuration: "0" },
        sync: { lfsThreshold: 512 * 1024 },
        filter: {},
        machineId: "test-machine-abc",
      }),
    );
    await writeFile(join(claudefyDir, "links.json"), "{}");
    await writeFile(
      join(claudefyDir, "sync-filter.json"),
      JSON.stringify({
        allowlist: ["commands", "agents", "settings.json"],
        denylist: ["cache"],
      }),
    );
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  it("pushes allowlisted files to remote store", async () => {
    const push = new PushCommand(homeDir);
    await push.execute({ quiet: false, skipEncryption: true });

    // Clone remote and verify
    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-verify-"));
    await simpleGit(verifyDir).clone(remoteDir, "store");
    const storePath = join(verifyDir, "store");

    const command = await readFile(join(storePath, "config", "commands", "test.md"), "utf-8");
    expect(command).toBe("# Test Command");

    const agent = await readFile(join(storePath, "config", "agents", "my-agent.md"), "utf-8");
    expect(agent).toBe("# Agent");

    await rm(verifyDir, { recursive: true, force: true });
  });

  it("does not push denylisted files", async () => {
    const push = new PushCommand(homeDir);
    await push.execute({ quiet: false, skipEncryption: true });

    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-verify-"));
    await simpleGit(verifyDir).clone(remoteDir, "store");
    const storePath = join(verifyDir, "store");

    const entries = await readdir(join(storePath, "config")).catch(() => []);
    expect(entries).not.toContain("cache");

    await rm(verifyDir, { recursive: true, force: true });
  });

  it("pushes unknown items to unknown directory", async () => {
    const push = new PushCommand(homeDir);
    await push.execute({ quiet: true, skipEncryption: true });

    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-verify-"));
    await simpleGit(verifyDir).clone(remoteDir, "store");
    const storePath = join(verifyDir, "store");

    const version = await readFile(join(storePath, "unknown", "get-shit-done", "VERSION"), "utf-8");
    expect(version).toBe("1.0.0");

    await rm(verifyDir, { recursive: true, force: true });
  });

  it("normalizes absolute paths in settings.json on push", async () => {
    await writeFile(
      join(claudeDir, "settings.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: `node "${claudeDir}/hooks/my-hook.js"`,
                },
              ],
            },
          ],
        },
      }),
    );

    const push = new PushCommand(homeDir);
    await push.execute({ quiet: true, skipEncryption: true });

    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-verify-"));
    await simpleGit(verifyDir).clone(remoteDir, "store");
    const settings = JSON.parse(
      await readFile(join(verifyDir, "store", "config", "settings.json"), "utf-8"),
    );
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain("@@CLAUDE_DIR@@");
    expect(settings.hooks.SessionStart[0].hooks[0].command).not.toContain(claudeDir);

    await rm(verifyDir, { recursive: true, force: true });
  });

  it("updates machine registry on push", async () => {
    const push = new PushCommand(homeDir);
    await push.execute({ quiet: true, skipEncryption: true });

    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-verify-"));
    await simpleGit(verifyDir).clone(remoteDir, "store");
    const storePath = join(verifyDir, "store");

    const manifest = JSON.parse(await readFile(join(storePath, "manifest.json"), "utf-8"));
    expect(manifest.machines).toHaveLength(1);
    expect(manifest.machines[0].machineId).toBe("test-machine-abc");

    await rm(verifyDir, { recursive: true, force: true });
  });

  it("encrypts files containing secrets when encryption is enabled", async () => {
    // Add a file with a secret
    await mkdir(join(claudeDir, "projects"), { recursive: true });
    await writeFile(
      join(claudeDir, "projects", "session.jsonl"),
      '{"msg": "key is sk-ant-ABCDEFGHIJKLMNOPQRSTUVWX"}',
    );

    // Update config to enable encryption and allowlist projects
    await writeFile(
      join(claudefyDir, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: remoteDir },
        encryption: { enabled: true, useKeychain: false, cacheDuration: "0" },
        sync: { lfsThreshold: 512 * 1024 },
        filter: {},
        machineId: "test-machine-enc",
      }),
    );
    await writeFile(
      join(claudefyDir, "sync-filter.json"),
      JSON.stringify({
        allowlist: ["commands", "agents", "settings.json", "projects"],
        denylist: ["cache"],
      }),
    );

    const push = new PushCommand(homeDir);
    await push.execute({ quiet: true, passphrase: "test-secret-pass" });

    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-verify-"));
    await simpleGit(verifyDir).clone(remoteDir, "store");
    const storePath = join(verifyDir, "store");

    // File with secret should be encrypted
    expect(existsSync(join(storePath, "config", "projects", "session.jsonl.age"))).toBe(true);
    expect(existsSync(join(storePath, "config", "projects", "session.jsonl"))).toBe(false);

    // File without secrets should remain plaintext
    expect(existsSync(join(storePath, "config", "settings.json"))).toBe(true);
    expect(existsSync(join(storePath, "config", "settings.json.age"))).toBe(false);

    // Encrypted content should not be readable as plaintext
    const encryptedContent = await readFile(
      join(storePath, "config", "projects", "session.jsonl.age"),
    );
    expect(encryptedContent.toString()).not.toContain("sk-ant-");

    await rm(verifyDir, { recursive: true, force: true });
  });
});
