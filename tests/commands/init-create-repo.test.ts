import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InitCommand } from "../../src/commands/init.js";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";

describe("InitCommand --create-repo", () => {
  let homeDir: string;
  let remoteDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-init-repo-test-"));
    const claudeDir = join(homeDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, "settings.json"), '{"key": "value"}');

    remoteDir = await mkdtemp(join(tmpdir(), "claudefy-init-repo-remote-"));
    await simpleGit(remoteDir).init(true);
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  it("uses RepoCreator when createRepo is true and no backend", async () => {
    const cmd = new InitCommand(homeDir);

    const { RepoCreator } = await import("../../src/repo-creator/repo-creator.js");
    vi.spyOn(RepoCreator.prototype, "create").mockResolvedValue(remoteDir);

    await cmd.execute({
      backend: undefined as unknown as string,
      quiet: true,
      skipEncryption: true,
      createRepo: true,
    });

    expect(RepoCreator.prototype.create).toHaveBeenCalled();
  });

  it("throws when no backend and no createRepo", async () => {
    const cmd = new InitCommand(homeDir);
    await expect(
      cmd.execute({
        backend: undefined as unknown as string,
        quiet: true,
        skipEncryption: true,
      }),
    ).rejects.toThrow(/backend/i);
  });
});
