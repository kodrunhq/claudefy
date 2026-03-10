import { cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

export class BackupManager {
  private backupsDir: string;

  constructor(claudefyDir: string) {
    this.backupsDir = join(claudefyDir, "backups");
  }

  async createBackup(claudeDir: string, label: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `${timestamp}--${label}`;
    const backupPath = join(this.backupsDir, backupName);

    await mkdir(backupPath, { recursive: true });
    await cp(claudeDir, backupPath, { recursive: true });

    return backupPath;
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
