import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";

import { InitCommand } from "../../src/commands/init.js";
import { JoinCommand } from "../../src/commands/join.js";

describe("Path Remapping Integration", () => {
  let homeDirA: string;
  let homeDirB: string;
  let remoteDir: string;

  beforeEach(async () => {
    homeDirA = await mkdtemp(join(tmpdir(), "claudefy-remap-a-"));
    homeDirB = await mkdtemp(join(tmpdir(), "claudefy-remap-b-"));
    remoteDir = await mkdtemp(join(tmpdir(), "claudefy-remap-remote-"));
    await simpleGit(remoteDir).init(true, ["-b", "main"]);
  });

  afterEach(async () => {
    await rm(homeDirA, { recursive: true, force: true });
    await rm(homeDirB, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  it("remaps settings.json paths between machines", async () => {
    // Setup Machine A
    const claudeDirA = join(homeDirA, ".claude");
    await mkdir(claudeDirA, { recursive: true });

    // Settings with machine-specific paths (using claudeDir as base)
    // Note: mcpServers is stripped as a dangerous key on pull, so we use a safe key
    await writeFile(
      join(claudeDirA, "settings.json"),
      JSON.stringify({
        customPaths: {
          test: {
            command: join(claudeDirA, "plugins", "test-server", "run.sh"),
          },
        },
      }),
    );

    // Machine A: init
    const initA = new InitCommand(homeDirA);
    await initA.execute({
      backend: remoteDir,
      quiet: true,
      skipEncryption: true,
    });

    // Setup Machine B
    const claudeDirB = join(homeDirB, ".claude");
    await mkdir(claudeDirB, { recursive: true });
    await writeFile(join(claudeDirB, "settings.json"), JSON.stringify({}));

    // Machine B: join (pulls and remaps paths)
    const joinB = new JoinCommand(homeDirB);
    await joinB.execute({
      backend: remoteDir,
      quiet: true,
      skipEncryption: true,
    });

    // Verify paths were remapped to Machine B's claudeDir
    const settingsB = JSON.parse(await readFile(join(claudeDirB, "settings.json"), "utf-8"));
    expect(settingsB.customPaths?.test?.command).toBeDefined();
    expect(settingsB.customPaths!.test!.command!).toContain(claudeDirB);
    expect(settingsB.customPaths!.test!.command!).not.toContain(claudeDirA);
  });
});
