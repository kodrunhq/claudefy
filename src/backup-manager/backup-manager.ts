import { cp, mkdir, readdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";

export class BackupManager {
  private backupsDir: string;

  constructor(claudefyDir: string) {
    this.backupsDir = join(claudefyDir, "backups");
  }

  async createBackup(claudeDir: string, label: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeLabel = label.replace(/[^a-zA-Z0-9._-]/g, "_");
    const backupName = `${timestamp}--${safeLabel}`;
    const backupPath = join(this.backupsDir, backupName);

    await mkdir(backupPath, { recursive: true });
    await cp(claudeDir, backupPath, { recursive: true, verbatimSymlinks: true });

    return backupPath;
  }

  getBackupPath(name: string): string {
    const resolved = resolve(this.backupsDir, name);
    const rel = relative(this.backupsDir, resolved);
    if (rel.startsWith("..")) {
      throw new Error(`Invalid backup name: "${name}"`);
    }
    return resolved;
  }

  async listBackups(): Promise<string[]> {
    try {
      const entries = await readdir(this.backupsDir);
      return entries.sort().reverse();
    } catch {
      return [];
    }
  }
}
