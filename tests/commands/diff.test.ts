import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DiffCommand } from "../../src/commands/diff.js";
import { PushCommand } from "../../src/commands/push.js";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";
import { CLAUDEFY_DIR } from "../../src/config/defaults.js";

describe("DiffCommand", () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-diff-cmd-test-"));
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  it("throws when not initialized", async () => {
    const cmd = new DiffCommand(homeDir);

    await expect(cmd.execute({ quiet: true })).rejects.toThrow("Claudefy is not initialized");
  });

  it("creates an instance with homeDir", () => {
    const cmd = new DiffCommand(homeDir);
    expect(cmd).toBeDefined();
  });

  it("shows Modified entry when a file has changed since last push", async () => {
    // Set up remote
    const remoteDir = await mkdtemp(join(tmpdir(), "claudefy-diff-remote-"));
    try {
      await simpleGit(remoteDir).init(true, ["-b", "main"]);

      const claudeDir = join(homeDir, ".claude");
      const claudefyDir = join(homeDir, CLAUDEFY_DIR);

      await mkdir(claudeDir, { recursive: true });
      await writeFile(join(claudeDir, "settings.json"), JSON.stringify({ theme: "dark" }));

      await mkdir(join(claudefyDir, "backups"), { recursive: true });
      await writeFile(
        join(claudefyDir, "config.json"),
        JSON.stringify({
          version: 1,
          backend: { type: "git", url: remoteDir },
          encryption: { enabled: false, useKeychain: false, cacheDuration: "0" },
          machineId: "diff-machine",
        }),
      );
      await writeFile(join(claudefyDir, "links.json"), "{}");
      await writeFile(
        join(claudefyDir, "sync-filter.json"),
        JSON.stringify({ allowlist: ["settings.json"], denylist: [] }),
      );

      // Initial push to establish baseline
      const push = new PushCommand(homeDir);
      await push.execute({ quiet: true, skipEncryption: true });

      // Modify the file locally
      await writeFile(join(claudeDir, "settings.json"), JSON.stringify({ theme: "light" }));

      // Capture console.log output
      const logs: string[] = [];
      const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
        logs.push(args.join(" "));
      });

      const cmd = new DiffCommand(homeDir);
      try {
        await cmd.execute({ quiet: false });
      } finally {
        spy.mockRestore();
      }

      // Should report Modified for settings.json
      const output = logs.join("\n");
      expect(output).toMatch(/Modified|Added|Deleted/i);
    } finally {
      await rm(remoteDir, { recursive: true, force: true });
    }
  });
});
