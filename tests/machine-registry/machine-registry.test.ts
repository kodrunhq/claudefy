import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MachineRegistry } from "../../src/machine-registry/machine-registry.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("MachineRegistry", () => {
  let tempDir: string;
  let manifestPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-registry-test-"));
    manifestPath = join(tempDir, "manifest.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("registers a new machine", async () => {
    const registry = new MachineRegistry(manifestPath);
    await registry.register("nuc-i7-abc123", "nuc-i7", "linux");

    const machines = await registry.list();
    expect(machines).toHaveLength(1);
    expect(machines[0].machineId).toBe("nuc-i7-abc123");
    expect(machines[0].hostname).toBe("nuc-i7");
    expect(machines[0].os).toBe("linux");
  });

  it("updates last sync time on existing machine", async () => {
    const registry = new MachineRegistry(manifestPath);
    await registry.register("nuc-i7-abc123", "nuc-i7", "linux");
    const before = (await registry.list())[0].lastSync;

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 10));
    await registry.updateLastSync("nuc-i7-abc123");
    const after = (await registry.list())[0].lastSync;

    expect(after).not.toBe(before);
  });

  it("handles multiple machines", async () => {
    const registry = new MachineRegistry(manifestPath);
    await registry.register("nuc-i7-abc123", "nuc-i7", "linux");
    await registry.register("macbook-def456", "macbook-pro", "darwin");

    const machines = await registry.list();
    expect(machines).toHaveLength(2);
  });
});
