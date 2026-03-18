import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DoctorCommand } from "../../src/commands/doctor.js";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("DoctorCommand", () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-doctor-test-"));
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  it("reports git as available", async () => {
    const cmd = new DoctorCommand(homeDir);
    const checks = await cmd.execute();
    const gitCheck = checks.find((c) => c.name === "git");
    expect(gitCheck).toBeDefined();
    expect(gitCheck!.status).toBe("pass");
  });

  it("reports not initialized when no config", async () => {
    const cmd = new DoctorCommand(homeDir);
    const checks = await cmd.execute();
    const initCheck = checks.find((c) => c.name === "store-initialized");
    expect(initCheck).toBeDefined();
    expect(initCheck!.status).toBe("fail");
  });

  it("reports initialized when config exists", async () => {
    const claudefyDir = join(homeDir, ".claudefy");
    await mkdir(claudefyDir, { recursive: true });
    await writeFile(
      join(claudefyDir, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: "https://example.com/repo.git" },
        encryption: { enabled: true, useKeychain: false, cacheDuration: "0" },
        machineId: "test-machine",
      }),
    );

    const cmd = new DoctorCommand(homeDir);
    const checks = await cmd.execute();
    const initCheck = checks.find((c) => c.name === "store-initialized");
    expect(initCheck!.status).toBe("pass");
  });

  it("reports encryption status", async () => {
    const claudefyDir = join(homeDir, ".claudefy");
    await mkdir(claudefyDir, { recursive: true });
    await writeFile(
      join(claudefyDir, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: "https://example.com/repo.git" },
        encryption: { enabled: true, useKeychain: false, cacheDuration: "0" },
        machineId: "test-machine",
      }),
    );

    const cmd = new DoctorCommand(homeDir);
    const checks = await cmd.execute();
    const encCheck = checks.find((c) => c.name === "encryption");
    expect(encCheck).toBeDefined();
    expect(encCheck!.status).toBe("pass");
    expect(encCheck!.detail).toContain("Enabled");
  });

  it("reports recent-sync pass when log has no errors", async () => {
    const claudefyDir = join(homeDir, ".claudefy");
    await mkdir(join(claudefyDir, "logs"), { recursive: true });
    await writeFile(
      join(claudefyDir, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: "https://example.com/repo.git" },
        encryption: { enabled: false, useKeychain: false, cacheDuration: "0" },
        machineId: "test-machine",
      }),
    );
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      operation: "push",
      message: "Push complete",
    });
    await writeFile(join(claudefyDir, "logs", "sync.log"), entry + "\n");

    const cmd = new DoctorCommand(homeDir);
    const checks = await cmd.execute();
    const syncCheck = checks.find((c) => c.name === "recent-sync");
    expect(syncCheck).toBeDefined();
    expect(syncCheck!.status).toBe("pass");
  });

  it("reports recent-sync warn when log has recent errors", async () => {
    const claudefyDir = join(homeDir, ".claudefy");
    await mkdir(join(claudefyDir, "logs"), { recursive: true });
    await writeFile(
      join(claudefyDir, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: "https://example.com/repo.git" },
        encryption: { enabled: false, useKeychain: false, cacheDuration: "0" },
        machineId: "test-machine",
      }),
    );
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      operation: "push",
      message: "Push failed: network error",
    });
    await writeFile(join(claudefyDir, "logs", "sync.log"), entry + "\n");

    const cmd = new DoctorCommand(homeDir);
    const checks = await cmd.execute();
    const syncCheck = checks.find((c) => c.name === "recent-sync");
    expect(syncCheck).toBeDefined();
    expect(syncCheck!.status).toBe("warn");
    expect(syncCheck!.detail).toContain("error");
  });

  it("reports recent-sync warn when no log entries exist", async () => {
    const cmd = new DoctorCommand(homeDir);
    const checks = await cmd.execute();
    const syncCheck = checks.find((c) => c.name === "recent-sync");
    expect(syncCheck).toBeDefined();
    expect(syncCheck!.status).toBe("warn");
    expect(syncCheck!.detail).toContain("No sync log entries");
  });
});
