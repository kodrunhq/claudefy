import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { BackupManager } from "../backup-manager/backup-manager.js";
import { output } from "../output.js";

export interface RestoreOptions {
  quiet: boolean;
}

export class RestoreCommand {
  private homeDir: string;
  private claudeDir: string;
  private backupManager: BackupManager;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
    this.claudeDir = join(homeDir, ".claude");
    this.backupManager = new BackupManager(join(homeDir, ".claudefy"));
  }

  async listAvailableBackups(): Promise<string[]> {
    return this.backupManager.listBackups();
  }

  async restoreByName(backupName: string, options: RestoreOptions): Promise<void> {
    const backupPath = this.backupManager.getBackupPath(backupName);
    if (!existsSync(backupPath)) {
      throw new Error(`Backup not found: ${backupName}`);
    }

    if (existsSync(this.claudeDir)) {
      const safetyPath = await this.backupManager.createBackup(this.claudeDir, "pre-restore");
      if (!options.quiet) {
        output.info(`Safety backup created at: ${safetyPath}`);
      }
    }

    if (existsSync(this.claudeDir)) {
      await rm(this.claudeDir, { recursive: true, force: true });
    }
    await cp(backupPath, this.claudeDir, { recursive: true });

    if (!options.quiet) {
      output.success(`Restored from backup: ${backupName}`);
    }
  }

  async executeInteractive(options: RestoreOptions): Promise<void> {
    const backups = await this.listAvailableBackups();
    if (backups.length === 0) {
      output.info("No backups available.");
      return;
    }

    console.log("\nAvailable backups:\n");
    for (let i = 0; i < backups.length; i++) {
      console.log(`  ${i + 1}. ${backups[i]}`);
    }
    console.log();

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (question: string): Promise<string> =>
      new Promise((resolve) => rl.question(question, resolve));

    try {
      const indexStr = await ask("Enter backup number to restore: ");
      const index = parseInt(indexStr, 10) - 1;
      if (isNaN(index) || index < 0 || index >= backups.length) {
        output.error("Invalid selection.");
        return;
      }

      const selected = backups[index];
      const confirm = await ask(`This will replace ~/.claude with backup "${selected}". Continue? (y/N) `);
      if (confirm.toLowerCase() !== "y") {
        output.info("Restore cancelled.");
        return;
      }

      await this.restoreByName(selected, options);
    } finally {
      rl.close();
    }
  }
}
