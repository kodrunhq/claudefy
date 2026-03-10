import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";
import { existsSync } from "node:fs";

import { InitCommand } from "../../src/commands/init.js";
import { JoinCommand } from "../../src/commands/join.js";
import { PushCommand } from "../../src/commands/push.js";
import { PullCommand } from "../../src/commands/pull.js";
import { OverrideCommand } from "../../src/commands/override.js";

describe("Full Sync Cycle", () => {
  let homeDirA: string;
  let homeDirB: string;
  let remoteDir: string;

  beforeEach(async () => {
    homeDirA = await mkdtemp(join(tmpdir(), "claudefy-int-a-"));
    homeDirB = await mkdtemp(join(tmpdir(), "claudefy-int-b-"));
    remoteDir = await mkdtemp(join(tmpdir(), "claudefy-int-remote-"));
    await simpleGit(remoteDir).init(true, ["-b", "main"]);

    // Create Machine A's ~/.claude
    const claudeDirA = join(homeDirA, ".claude");
    await mkdir(join(claudeDirA, "commands"), { recursive: true });
    await writeFile(join(claudeDirA, "commands", "test.md"), "# Test Command");
    await writeFile(join(claudeDirA, "settings.json"), JSON.stringify({ theme: "dark" }));

    // Create Machine B's ~/.claude (minimal)
    const claudeDirB = join(homeDirB, ".claude");
    await mkdir(claudeDirB, { recursive: true });
    await writeFile(join(claudeDirB, "settings.json"), JSON.stringify({ theme: "light" }));
  });

  afterEach(async () => {
    await rm(homeDirA, { recursive: true, force: true });
    await rm(homeDirB, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  it("syncs config between two machines", async () => {
    // 1. Machine A: init → push
    const initCmd = new InitCommand(homeDirA);
    await initCmd.execute({
      backend: remoteDir,
      quiet: true,
      skipEncryption: true,
    });

    // 2. Machine B: join → verify content arrived
    const joinCmd = new JoinCommand(homeDirB);
    await joinCmd.execute({
      backend: remoteDir,
      quiet: true,
      skipEncryption: true,
    });

    // Verify Machine B got Machine A's commands
    const claudeDirB = join(homeDirB, ".claude");
    expect(existsSync(join(claudeDirB, "commands", "test.md"))).toBe(true);
    const testMd = await readFile(join(claudeDirB, "commands", "test.md"), "utf-8");
    expect(testMd).toBe("# Test Command");

    // 3. Machine B: modify content → push
    await writeFile(join(claudeDirB, "commands", "new-cmd.md"), "# New Command");
    const pushB = new PushCommand(homeDirB);
    await pushB.execute({ quiet: true, skipEncryption: true });

    // 4. Machine A: pull → verify Machine B's changes
    const pullA = new PullCommand(homeDirA);
    await pullA.execute({ quiet: true, skipEncryption: true });

    const claudeDirA = join(homeDirA, ".claude");
    expect(existsSync(join(claudeDirA, "commands", "new-cmd.md"))).toBe(true);
    const newCmd = await readFile(join(claudeDirA, "commands", "new-cmd.md"), "utf-8");
    expect(newCmd).toBe("# New Command");
  });

  it("handles override flow between machines", async () => {
    // 1. Machine A: init
    const initCmd = new InitCommand(homeDirA);
    await initCmd.execute({
      backend: remoteDir,
      quiet: true,
      skipEncryption: true,
    });

    // 2. Machine B: join
    const joinCmd = new JoinCommand(homeDirB);
    await joinCmd.execute({
      backend: remoteDir,
      quiet: true,
      skipEncryption: true,
    });

    // 3. Machine A: modify settings and override
    const claudeDirA = join(homeDirA, ".claude");
    await writeFile(join(claudeDirA, "settings.json"), JSON.stringify({ theme: "override-theme" }));
    const overrideCmd = new OverrideCommand(homeDirA);
    await overrideCmd.execute({
      quiet: true,
      skipEncryption: true,
      confirm: true,
    });

    // 4. Machine B: pull → detect override, backup created
    const pullB = new PullCommand(homeDirB);
    const result = await pullB.execute({ quiet: true, skipEncryption: true });

    expect(result.overrideDetected).toBe(true);
    expect(result.backupPath).toBeDefined();

    // Verify Machine B got the override content
    const claudeDirB = join(homeDirB, ".claude");
    const settings = JSON.parse(await readFile(join(claudeDirB, "settings.json"), "utf-8"));
    expect(settings.theme).toBe("override-theme");
  });
});
