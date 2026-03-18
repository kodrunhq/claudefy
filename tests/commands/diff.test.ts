import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DiffCommand } from "../../src/commands/diff.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
});
