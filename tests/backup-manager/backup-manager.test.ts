import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BackupManager } from "../../src/backup-manager/backup-manager.js";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { CLAUDEFY_DIR } from "../../src/config/defaults.js";

describe("BackupManager", () => {
  let tempDir: string;
  let claudeDir: string;
  let claudefyDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-backup-test-"));
    claudeDir = join(tempDir, ".claude");
    claudefyDir = join(tempDir, CLAUDEFY_DIR);
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
    const settings = await readFile(join(backupPath, "settings.json"), "utf-8");
    expect(settings).toBe('{"key": "value"}');
    const command = await readFile(join(backupPath, "commands", "test.md"), "utf-8");
    expect(command).toBe("# Test");
  });

  it("resolves backup name to full path", async () => {
    await writeFile(join(claudeDir, "settings.json"), "{}");
    const backupManager = new BackupManager(claudefyDir);
    const backupPath = await backupManager.createBackup(claudeDir, "test-backup");
    const backups = await backupManager.listBackups();
    const resolved = backupManager.getBackupPath(backups[0]);
    expect(resolved).toBe(backupPath);
  });

  it("lists existing backups", async () => {
    await writeFile(join(claudeDir, "settings.json"), "{}");
    const backupManager = new BackupManager(claudefyDir);

    await backupManager.createBackup(claudeDir, "backup-1");
    await backupManager.createBackup(claudeDir, "backup-2");

    const backups = await backupManager.listBackups();
    expect(backups.length).toBe(2);
  });

  it("prune keeps only maxCount newest backups", async () => {
    await writeFile(join(claudeDir, "settings.json"), "{}");
    const backupManager = new BackupManager(claudefyDir);

    await backupManager.createBackup(claudeDir, "first");
    await new Promise((r) => setTimeout(r, 10));
    await backupManager.createBackup(claudeDir, "second");
    await new Promise((r) => setTimeout(r, 10));
    await backupManager.createBackup(claudeDir, "third");

    await backupManager.prune({ maxCount: 2 });

    const remaining = await backupManager.listBackups();
    expect(remaining.length).toBe(2);
  });

  it("prune removes backups older than maxAgeDays", async () => {
    await writeFile(join(claudeDir, "settings.json"), "{}");
    const backupManager = new BackupManager(claudefyDir);

    // Create a backup
    const backupPath = await backupManager.createBackup(claudeDir, "old-backup");

    // Artificially age the backup by setting its mtime to 10 days ago
    const { utimes } = await import("node:fs/promises");
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await utimes(backupPath, tenDaysAgo, tenDaysAgo);

    // Create a recent backup
    await backupManager.createBackup(claudeDir, "new-backup");

    await backupManager.prune({ maxAgeDays: 5 });

    const remaining = await backupManager.listBackups();
    expect(remaining.length).toBe(1);
    expect(remaining[0]).toContain("new-backup");
  });
});
