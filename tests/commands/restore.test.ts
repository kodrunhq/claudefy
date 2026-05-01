import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RestoreCommand } from "../../src/commands/restore.js";
import { BackupManager } from "../../src/backup-manager/backup-manager.js";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CLAUDEFY_DIR } from "../../src/config/defaults.js";

describe("RestoreCommand", () => {
  let homeDir: string;
  let claudeDir: string;
  let claudefyDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-restore-test-"));
    claudeDir = join(homeDir, ".claude");
    claudefyDir = join(homeDir, CLAUDEFY_DIR);
    await mkdir(claudeDir, { recursive: true });
    await mkdir(join(claudefyDir, "backups"), { recursive: true });
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  it("restores a backup to ~/.claude", async () => {
    await writeFile(join(claudeDir, "settings.json"), '{"original": true}');
    const backupManager = new BackupManager(claudefyDir);
    await backupManager.createBackup(claudeDir, "test-backup");
    await writeFile(join(claudeDir, "settings.json"), '{"changed": true}');

    const cmd = new RestoreCommand(homeDir);
    const backups = await backupManager.listBackups();
    await cmd.restoreByName(backups[0], { quiet: true });

    const settings = await readFile(join(claudeDir, "settings.json"), "utf-8");
    expect(JSON.parse(settings)).toEqual({ original: true });
  });

  it("creates safety backup before restoring", async () => {
    await writeFile(join(claudeDir, "settings.json"), '{"current": true}');
    const backupManager = new BackupManager(claudefyDir);
    await backupManager.createBackup(claudeDir, "old-backup");

    const cmd = new RestoreCommand(homeDir);
    const backups = await backupManager.listBackups();
    await cmd.restoreByName(backups[0], { quiet: true });

    const allBackups = await backupManager.listBackups();
    expect(allBackups.length).toBe(2);
    expect(allBackups.some((b) => b.includes("pre-restore"))).toBe(true);
  });

  it("returns empty list when no backups exist", async () => {
    const cmd = new RestoreCommand(homeDir);
    const backups = await cmd.listAvailableBackups();
    expect(backups).toEqual([]);
  });
});
