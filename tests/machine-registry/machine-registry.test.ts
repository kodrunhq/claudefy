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

  it("updates last sync time on re-register", async () => {
    const registry = new MachineRegistry(manifestPath);
    await registry.register("nuc-i7-abc123", "nuc-i7", "linux");
    const before = (await registry.list())[0].lastSync;

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 10));
    await registry.register("nuc-i7-abc123", "nuc-i7", "linux");
    const after = (await registry.list())[0].lastSync;

    expect(after).not.toBe(before);
  });

  it("conditionalRegister skips update when shouldUpdate is false", async () => {
    const registry = new MachineRegistry(manifestPath);
    await registry.register("m1", "host1", "linux");
    const before = (await registry.list())[0].lastSync;

    await new Promise((r) => setTimeout(r, 10));
    await registry.conditionalRegister("m1", "host1", "linux", false);
    const after = (await registry.list())[0].lastSync;
    expect(after).toBe(before);
  });

  it("conditionalRegister updates when shouldUpdate is true", async () => {
    const registry = new MachineRegistry(manifestPath);
    await registry.register("m1", "host1", "linux");
    const before = (await registry.list())[0].lastSync;

    await new Promise((r) => setTimeout(r, 10));
    await registry.conditionalRegister("m1", "host1", "linux", true);
    const after = (await registry.list())[0].lastSync;
    expect(after).not.toBe(before);
  });

  it("conditionalRegister always registers new machines", async () => {
    const registry = new MachineRegistry(manifestPath);
    await registry.conditionalRegister("new-machine", "host", "linux", false);
    const machines = await registry.list();
    expect(machines).toHaveLength(1);
    expect(machines[0].machineId).toBe("new-machine");
  });

  it("handles multiple machines", async () => {
    const registry = new MachineRegistry(manifestPath);
    await registry.register("nuc-i7-abc123", "nuc-i7", "linux");
    await registry.register("macbook-def456", "macbook-pro", "darwin");

    const machines = await registry.list();
    expect(machines).toHaveLength(2);
  });
});
