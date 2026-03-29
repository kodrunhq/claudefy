import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";

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
    if (rel.startsWith("..") || isAbsolute(rel)) {
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

  /**
   * Prune old backups. Removes backups older than maxAgeDays and keeps only
   * the most recent maxCount backups.
   */
  async prune(options: { maxCount?: number; maxAgeDays?: number } = {}): Promise<void> {
    const { maxCount, maxAgeDays } = options;
    if (maxCount === undefined && maxAgeDays === undefined) return;

    let backups = await this.listBackups(); // newest first

    // Remove backups older than maxAgeDays
    if (maxAgeDays !== undefined) {
      const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
      const remaining: string[] = [];
      for (const name of backups) {
        const fullPath = join(this.backupsDir, name);
        try {
          const s = await stat(fullPath);
          if (s.mtimeMs >= cutoff) {
            remaining.push(name);
          } else {
            await rm(fullPath, { recursive: true, force: true });
          }
        } catch {
          remaining.push(name); // Can't stat — preserve
        }
      }
      backups = remaining;
    }

    // Remove excess backups beyond maxCount (list is newest-first, keep first maxCount)
    if (maxCount !== undefined && backups.length > maxCount) {
      const toDelete = backups.slice(maxCount);
      for (const name of toDelete) {
        await rm(join(this.backupsDir, name), { recursive: true, force: true });
      }
    }
  }
}
