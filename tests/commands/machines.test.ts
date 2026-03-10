import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MachinesCommand } from "../../src/commands/machines.js";
import { InitCommand } from "../../src/commands/init.js";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";

describe("MachinesCommand", () => {
  let homeDir: string;
  let remoteDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-machines-test-"));
    remoteDir = await mkdtemp(join(tmpdir(), "claudefy-machines-remote-"));
    await simpleGit(remoteDir).init(true);

    // Create ~/.claude with some content
    const claudeDir = join(homeDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, "settings.json"), '{"key": "value"}');
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  it("lists registered machines after init", async () => {
    // InitCommand registers the first machine
    const initCmd = new InitCommand(homeDir);
    await initCmd.execute({ backend: remoteDir, quiet: true, skipEncryption: true });

    const cmd = new MachinesCommand(homeDir);
    const machines = await cmd.execute();

    expect(machines.length).toBeGreaterThanOrEqual(1);
    expect(machines[0].machineId).toBeDefined();
    expect(machines[0].hostname).toBeDefined();
  });

  it("returns machines from fresh store with init machine only", async () => {
    // Init creates a single machine entry
    const initCmd = new InitCommand(homeDir);
    await initCmd.execute({ backend: remoteDir, quiet: true, skipEncryption: true });

    const cmd = new MachinesCommand(homeDir);
    const machines = await cmd.execute();

    // Should have exactly the machine registered during init
    expect(machines).toHaveLength(1);
  });
});
