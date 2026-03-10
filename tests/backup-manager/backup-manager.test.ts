import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BackupManager } from "../../src/backup-manager/backup-manager.js";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

describe("BackupManager", () => {
  let tempDir: string;
  let claudeDir: string;
  let claudefyDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-backup-test-"));
    claudeDir = join(tempDir, ".claude");
    claudefyDir = join(tempDir, ".claudefy");
    await mkdir(claudeDir);
    await mkdir(claudefyDir);
    await mkdir(join(claudefyDir, "backups"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates a timestamped backup of ~/.claude", async () => {
    await mkdir(join(claudeDir, "commands"));
    await writeFile(join(claudeDir, "commands", "test.md"), "# Test");
    await writeFile(join(claudeDir, "settings.json"), '{"key": "value"}');

    const backupManager = new BackupManager(claudefyDir);
    const backupPath = await backupManager.createBackup(claudeDir, "pre-override");

    expect(existsSync(backupPath)).toBe(true);
    const settings = await readFile(
      join(backupPath, "settings.json"),
      "utf-8"
    );
    expect(settings).toBe('{"key": "value"}');
    const command = await readFile(
      join(backupPath, "commands", "test.md"),
      "utf-8"
    );
    expect(command).toBe("# Test");
  });

  it("lists existing backups", async () => {
    await writeFile(join(claudeDir, "settings.json"), "{}");
    const backupManager = new BackupManager(claudefyDir);

    await backupManager.createBackup(claudeDir, "backup-1");
    await backupManager.createBackup(claudeDir, "backup-2");

    const backups = await backupManager.listBackups();
    expect(backups.length).toBe(2);
  });
});
