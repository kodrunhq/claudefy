import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OverrideCommand } from "../../src/commands/override.js";
import { PushCommand } from "../../src/commands/push.js";
import { PullCommand } from "../../src/commands/pull.js";
import {
  mkdtemp, rm, mkdir, writeFile, readFile, readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";
import { existsSync } from "node:fs";

describe("OverrideCommand", () => {
  let homeDir: string;
  let claudeDir: string;
  let claudefyDir: string;
  let remoteDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-override-test-"));
    claudeDir = join(homeDir, ".claude");
    claudefyDir = join(homeDir, ".claudefy");

    // Create bare remote
    remoteDir = await mkdtemp(join(tmpdir(), "claudefy-override-remote-"));
    await simpleGit(remoteDir).init(true);

    // Create ~/.claude with test content
    await mkdir(join(claudeDir, "commands"), { recursive: true });
    await writeFile(join(claudeDir, "commands", "test.md"), "# Test Command");
    await mkdir(join(claudeDir, "agents"), { recursive: true });
    await writeFile(join(claudeDir, "agents", "my-agent.md"), "# Agent");
    await writeFile(join(claudeDir, "settings.json"), JSON.stringify({
      theme: "dark",
      editor: "vscode",
    }));

    // Initialize claudefy config
    await mkdir(join(claudefyDir, "backups"), { recursive: true });
    await writeFile(
      join(claudefyDir, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: remoteDir },
        encryption: { enabled: false, useKeychain: false, cacheDuration: "0" },
        sync: { lfsThreshold: 524288 },
        filter: {},
        machineId: "test-machine-a",
      })
    );
    await writeFile(join(claudefyDir, "machine-id"), "test-machine-a");
    await writeFile(
      join(claudefyDir, "sync-filter.json"),
      JSON.stringify({
        allowlist: ["commands", "agents", "settings.json"],
        denylist: ["cache"],
      })
    );
    await writeFile(join(claudefyDir, "links.json"), "{}");
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  it("throws without --confirm flag", async () => {
    const override = new OverrideCommand(homeDir);
    await expect(
      override.execute({ quiet: true, skipEncryption: true })
    ).rejects.toThrow("Override requires --confirm flag");
  });

  it("wipes remote and repopulates from local", async () => {
    // Initial push
    const push = new PushCommand(homeDir);
    await push.execute({ quiet: true, skipEncryption: true });

    // Modify local settings
    await writeFile(
      join(claudeDir, "settings.json"),
      JSON.stringify({ theme: "light", newKey: "newValue" })
    );

    // Run override
    const override = new OverrideCommand(homeDir);
    await override.execute({ quiet: true, skipEncryption: true, confirm: true });

    // Clone remote and verify new content is there
    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-verify-"));
    await simpleGit(verifyDir).clone(remoteDir, "store");
    const storePath = join(verifyDir, "store");

    const settings = JSON.parse(
      await readFile(join(storePath, "config", "settings.json"), "utf-8")
    );
    expect(settings.theme).toBe("light");
    expect(settings.newKey).toBe("newValue");
    // Original "editor" key should not be present (store was wiped)
    expect(settings.editor).toBeUndefined();

    // Commands should still be present (repopulated by push)
    const command = await readFile(
      join(storePath, "config", "commands", "test.md"),
      "utf-8"
    );
    expect(command).toBe("# Test Command");

    await rm(verifyDir, { recursive: true, force: true });
  });

  it("override marker is picked up by pull on another machine", async () => {
    // Machine A pushes initial content
    const push = new PushCommand(homeDir);
    await push.execute({ quiet: true, skipEncryption: true });

    // Machine A modifies settings and overrides
    await writeFile(
      join(claudeDir, "settings.json"),
      JSON.stringify({ theme: "override-theme", overrideOnly: true })
    );
    const override = new OverrideCommand(homeDir);
    await override.execute({ quiet: true, skipEncryption: true, confirm: true });

    // Set up Machine B
    const homeDirB = await mkdtemp(join(tmpdir(), "claudefy-override-machb-"));
    const claudeDirB = join(homeDirB, ".claude");
    const claudefyDirB = join(homeDirB, ".claudefy");

    await mkdir(claudeDirB, { recursive: true });
    await writeFile(
      join(claudeDirB, "settings.json"),
      JSON.stringify({ theme: "machine-b-theme", localKey: "localValue" })
    );

    await mkdir(join(claudefyDirB, "backups"), { recursive: true });
    await writeFile(
      join(claudefyDirB, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: remoteDir },
        encryption: { enabled: false, useKeychain: false, cacheDuration: "0" },
        sync: { lfsThreshold: 524288 },
        filter: {},
        machineId: "test-machine-b",
      })
    );
    await writeFile(join(claudefyDirB, "machine-id"), "test-machine-b");
    await writeFile(
      join(claudefyDirB, "sync-filter.json"),
      JSON.stringify({
        allowlist: ["commands", "agents", "settings.json"],
        denylist: ["cache"],
      })
    );
    await writeFile(join(claudefyDirB, "links.json"), "{}");

    // Machine B pulls — should detect override
    const pull = new PullCommand(homeDirB);
    const result = await pull.execute({ quiet: true, skipEncryption: true });

    expect(result.overrideDetected).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(existsSync(result.backupPath!)).toBe(true);

    // Machine B should get override content (no merge, full overwrite for settings)
    const settingsB = JSON.parse(
      await readFile(join(claudeDirB, "settings.json"), "utf-8")
    );
    expect(settingsB.theme).toBe("override-theme");
    expect(settingsB.overrideOnly).toBe(true);

    // Commands should be present
    const commandB = await readFile(
      join(claudeDirB, "commands", "test.md"),
      "utf-8"
    );
    expect(commandB).toBe("# Test Command");

    await rm(homeDirB, { recursive: true, force: true });
  });
});
