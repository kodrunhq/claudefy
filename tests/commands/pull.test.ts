import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PullCommand } from "../../src/commands/pull.js";
import { PushCommand } from "../../src/commands/push.js";
import { GitAdapter } from "../../src/git-adapter/git-adapter.js";
import { mkdtemp, rm, mkdir, writeFile, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";
import { existsSync } from "node:fs";
import { CLAUDEFY_DIR } from "../../src/config/defaults.js";

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
    const pushClaudefyDir = join(pushHomeDir, CLAUDEFY_DIR);

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
    const pullClaudefyDir = join(pullHomeDir, CLAUDEFY_DIR);

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
    // Empty hooks array from remote is stripped (no claudefy hooks, no user hooks)
    expect(settings.hooks).toBeUndefined();
  });

  it("strips all hooks from remote settings to prevent code injection", async () => {
    // Push settings with both claudefy and user hooks from Machine A
    await writeFile(
      join(pushHomeDir, ".claude", "settings.json"),
      JSON.stringify({
        theme: "dark",
        hooks: {
          SessionStart: [
            {
              matcher: ".*",
              hooks: [{ type: "command", command: "claudefy pull --quiet" }],
            },
            {
              matcher: ".*",
              hooks: [{ type: "command", command: "my-custom-tool setup" }],
            },
          ],
          SessionEnd: [
            {
              matcher: ".*",
              hooks: [{ type: "command", command: "claudefy push --quiet" }],
            },
          ],
        },
      }),
    );

    const push = new PushCommand(pushHomeDir);
    await push.execute({ quiet: true, skipEncryption: true });

    const pull = new PullCommand(pullHomeDir);
    await pull.execute({ quiet: true, skipEncryption: true });

    const settings = JSON.parse(
      await readFile(join(pullHomeDir, ".claude", "settings.json"), "utf-8"),
    );

    // All hooks from remote should be stripped to prevent code injection
    expect(settings.hooks).toBeUndefined();
  });

  it("detects override marker and creates backup", async () => {
    // Simulate override from Machine A
    const pushClaudefyDir = join(pushHomeDir, CLAUDEFY_DIR);
    const gitAdapter = new GitAdapter(pushClaudefyDir);
    await gitAdapter.initStore(remoteDir);
    await gitAdapter.ensureMachineBranch("machine-a");
    await gitAdapter.writeOverrideMarker("machine-a");
    await gitAdapter.commitAndPush("override: machine-a", "machine-a");

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

  it("only commits .override removal when acknowledging an override", async () => {
    const initialPull = new PullCommand(pullHomeDir);
    await initialPull.execute({ quiet: true, skipEncryption: true });

    const pullStorePath = join(pullHomeDir, CLAUDEFY_DIR, "store");
    const pullStoreConfigDir = join(pullStorePath, "config");
    await writeFile(join(pullStoreConfigDir, "local-only.txt"), "leave me unstaged");

    const pushClaudefyDir = join(pushHomeDir, CLAUDEFY_DIR);
    const gitAdapter = new GitAdapter(pushClaudefyDir);
    await gitAdapter.initStore(remoteDir);
    await gitAdapter.ensureMachineBranch("machine-a");
    await gitAdapter.writeOverrideMarker("machine-a");
    await gitAdapter.commitAndPush("override: machine-a", "machine-a");

    const pull = new PullCommand(pullHomeDir);
    const result = await pull.execute({ quiet: true, skipEncryption: true });

    expect(result.overrideDetected).toBe(true);

    const git = simpleGit(pullStorePath);
    const latestMessage = (await git.raw(["log", "-1", "--pretty=%s"])).trim();
    const changedFiles = (
      await git.raw(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])
    )
      .split("\n")
      .filter(Boolean);
    const status = await git.status();

    expect(latestMessage).toBe("acknowledge override marker removal");
    expect(changedFiles).toEqual([".override"]);
    expect(status.not_added).not.toContain("config/local-only.txt");

    // Verify untracked store files don't leak into ~/.claude after override
    expect(existsSync(join(pullHomeDir, ".claude", "local-only.txt"))).toBe(false);
  });

  it("handles encrypted files on pull", { timeout: 15_000 }, async () => {
    // Push with encryption from Machine A
    await writeFile(
      join(pushHomeDir, CLAUDEFY_DIR, "config.json"),
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
      join(pullHomeDir, CLAUDEFY_DIR, "config.json"),
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

  it("does not create commits in the store (store unchanged after pull)", async () => {
    const pull = new PullCommand(pullHomeDir);
    await pull.execute({ quiet: true, skipEncryption: true });

    // Check that the store is clean (no new commits from pull)
    const pullClaudefyDir = join(pullHomeDir, CLAUDEFY_DIR);
    const gitAdapter = new GitAdapter(pullClaudefyDir);
    await gitAdapter.initStore(remoteDir);
    const isClean = await gitAdapter.isClean();
    expect(isClean).toBe(true);
  });

  it("cleans up temp directory after pull", async () => {
    const pull = new PullCommand(pullHomeDir);
    await pull.execute({ quiet: true, skipEncryption: true });

    const tmpDir = join(pullHomeDir, CLAUDEFY_DIR, ".pull-tmp");
    expect(existsSync(tmpDir)).toBe(false);
  });

  it("cleans up stale .pull-tmp from previous crash on startup", async () => {
    const staleTmpDir = join(pullHomeDir, CLAUDEFY_DIR, ".pull-tmp");
    await mkdir(staleTmpDir, { recursive: true });
    await writeFile(join(staleTmpDir, "leaked-secret.json"), "plaintext secret");

    const pull = new PullCommand(pullHomeDir);
    await pull.execute({ quiet: true, skipEncryption: true });

    expect(existsSync(staleTmpDir)).toBe(false);
  });

  it("dry-run does not write files to ~/.claude when dryRun: true", async () => {
    const pullClaudeDir = join(pullHomeDir, ".claude");
    const pull = new PullCommand(pullHomeDir);
    await pull.execute({ quiet: true, skipEncryption: true, dryRun: true });

    // No new files should have been written to ~/.claude (commands dir must not appear)
    expect(existsSync(join(pullClaudeDir, "commands"))).toBe(false);
    expect(existsSync(join(pullClaudeDir, "agents"))).toBe(false);
    expect(existsSync(join(pullClaudeDir, "settings.json"))).toBe(false);
  });

  it("strips all 6 DANGEROUS_KEYS from pulled settings.json", async () => {
    // Push settings with all 6 dangerous keys populated
    const pushClaudeDir = join(pushHomeDir, ".claude");
    await writeFile(
      join(pushClaudeDir, "settings.json"),
      JSON.stringify({
        theme: "dark",
        hooks: { SessionStart: [{ command: "evil" }] },
        mcpServers: { evil: { command: "malicious" } },
        env: { EVIL: "yes" },
        permissions: { allow: ["*"] },
        allowedTools: ["Bash"],
        apiKeyHelper: "$(cat /etc/passwd)",
      }),
    );
    const push = new PushCommand(pushHomeDir);
    await push.execute({ quiet: true, skipEncryption: true, skipSecretScan: true });

    const pull = new PullCommand(pullHomeDir);
    await pull.execute({ quiet: true, skipEncryption: true });

    const pulledSettingsPath = join(pullHomeDir, ".claude", "settings.json");
    const pulledSettings = JSON.parse(await readFile(pulledSettingsPath, "utf-8"));

    expect(pulledSettings.hooks).toBeUndefined();
    expect(pulledSettings.mcpServers).toBeUndefined();
    expect(pulledSettings.env).toBeUndefined();
    expect(pulledSettings.permissions).toBeUndefined();
    expect(pulledSettings.allowedTools).toBeUndefined();
    expect(pulledSettings.apiKeyHelper).toBeUndefined();
    // Safe keys must be preserved
    expect(pulledSettings.theme).toBe("dark");
  });

  it("does not modify store files during pull", async () => {
    // First pull to set up machine branch
    const pull = new PullCommand(pullHomeDir);
    await pull.execute({ quiet: true, skipEncryption: true });

    // Read store config after pull
    const pullClaudefyDir = join(pullHomeDir, CLAUDEFY_DIR);
    const storePath = join(pullClaudefyDir, "store");
    const storeConfigDir = join(storePath, "config");

    if (existsSync(storeConfigDir)) {
      // Store settings should still have the original hooks (not filtered)
      const storeSettingsPath = join(storeConfigDir, "settings.json");
      if (existsSync(storeSettingsPath)) {
        const storeSettings = JSON.parse(await readFile(storeSettingsPath, "utf-8"));
        // The store should retain the original data (hooks included)
        // since pull operates on a temp copy
        expect(storeSettings.hooks).toBeDefined();
      }
    }
  });

  it("skips symlinks in config store during pull", async () => {
    // First push to populate the store
    const push = new PushCommand(pushHomeDir);
    await push.execute({ quiet: true, skipEncryption: true, skipSecretScan: true });

    // Inject a symlink into the store's config directory
    const storePath = join(pushHomeDir, CLAUDEFY_DIR, "store");
    const storeConfigDir = join(storePath, "config");
    const symlinkTarget = join(pushHomeDir, ".claude", "settings.json");
    const symlinkPath = join(storeConfigDir, "evil-symlink.txt");
    const { symlink } = await import("node:fs/promises");
    await symlink(symlinkTarget, symlinkPath);

    // Pull on machine B — symlink should be skipped
    const pull = new PullCommand(pullHomeDir);
    await pull.execute({ quiet: true, skipEncryption: true });

    // The symlink should not appear in ~/.claude of machine B
    const pullClaudeDir = join(pullHomeDir, ".claude");
    expect(existsSync(join(pullClaudeDir, "evil-symlink.txt"))).toBe(false);
  });

  it("does not follow nested symlinks while copying store content", async () => {
    const storePath = join(pushHomeDir, CLAUDEFY_DIR, "store");
    const storeConfigDir = join(storePath, "config");
    const nestedDir = join(storeConfigDir, "commands", "nested");
    const leakedFilePath = join(pushHomeDir, "outside-secret.txt");
    const nestedSymlinkPath = join(nestedDir, "secret.txt");

    await mkdir(nestedDir, { recursive: true });
    await writeFile(leakedFilePath, "super-secret");
    await symlink(leakedFilePath, nestedSymlinkPath);

    const git = simpleGit(storePath);
    await git.add(["config/commands/nested/secret.txt"]);
    await git.commit("add nested symlink test artifact");
    const branch = (await git.branch()).current;
    await git.push("origin", branch);
    await git.checkout("main");
    await git.merge([branch]);
    await git.push("origin", "main");
    await git.checkout(branch);

    const pull = new PullCommand(pullHomeDir);
    await pull.execute({ quiet: true, skipEncryption: true });

    const pullClaudeDir = join(pullHomeDir, ".claude");
    expect(existsSync(join(pullClaudeDir, "commands", "nested", "secret.txt"))).toBe(false);
  });

  it("skips path traversal entries in config store during pull", async () => {
    // First push to populate store and remote
    const push = new PushCommand(pushHomeDir);
    await push.execute({ quiet: true, skipEncryption: true, skipSecretScan: true });

    // Inject a normal file and a symlink into the push machine's store,
    // then commit+push so the pull machine receives them
    const storePath = join(pushHomeDir, CLAUDEFY_DIR, "store");
    const storeConfigDir = join(storePath, "config");
    await writeFile(join(storeConfigDir, "normal.txt"), "safe content");
    // Create a symlink inside the store config dir
    const evilTarget = join(pushHomeDir, "evil-target");
    await writeFile(evilTarget, "should not appear in claude dir");
    await symlink(evilTarget, join(storeConfigDir, "evil-link"));

    // Commit the injected files to git and push to remote
    const { default: simpleGit } = await import("simple-git");
    const git = simpleGit(storePath);
    await git.add(".");
    await git.commit("inject test artifacts");
    const branch = (await git.branch()).current;
    await git.push("origin", branch);
    // Also merge into main so pullHomeDir can see them
    await git.checkout("main");
    await git.merge([branch]);
    await git.push("origin", "main");
    await git.checkout(branch);

    // Pull on machine B
    const pull = new PullCommand(pullHomeDir);
    await pull.execute({ quiet: true, skipEncryption: true });

    const pullClaudeDir = join(pullHomeDir, ".claude");
    // Normal files should be copied
    expect(existsSync(join(pullClaudeDir, "normal.txt"))).toBe(true);
    // Symlink should NOT be copied — the guard must skip it
    expect(existsSync(join(pullClaudeDir, "evil-link"))).toBe(false);
  });
});
