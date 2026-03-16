import { rm } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { ConfigManager } from "../config/config-manager.js";
import { HookManager } from "../hook-manager/hook-manager.js";
import { output } from "../output.js";

export interface UninstallOptions {
  confirm?: boolean;
  quiet?: boolean;
}

export class UninstallCommand {
  private readonly homeDir: string;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
  }

  async execute(options: UninstallOptions): Promise<void> {
    const claudefyDir = join(this.homeDir, ".claudefy");

    if (!existsSync(claudefyDir)) {
      output.info("claudefy is not installed (no ~/.claudefy directory found).");
      return;
    }

    if (!options.confirm) {
      const confirmed = await this.promptConfirmation();
      if (!confirmed) {
        output.info("Uninstall cancelled.");
        return;
      }
    }

    // 1. Remove hooks from settings.json
    try {
      const hookManager = new HookManager(join(this.homeDir, ".claude", "settings.json"));
      await hookManager.remove();
      if (!options.quiet) output.info("Hooks removed from settings.json.");
    } catch {
      // Settings.json may not exist or hooks may not be installed
    }

    // 2. Read remote URL before deleting config
    let remoteUrl = "<unknown>";
    try {
      const configManager = new ConfigManager(this.homeDir);
      const config = await configManager.load();
      remoteUrl = config.backend.url;
    } catch {
      // Config may be corrupted
    }

    // 3. Delete ~/.claudefy/
    await rm(claudefyDir, { recursive: true, force: true });

    if (!options.quiet) {
      output.success("claudefy has been uninstalled.");
      output.info(`Remote repository at ${remoteUrl} was NOT deleted. Remove manually if desired.`);
    }
  }

  private async promptConfirmation(): Promise<boolean> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise<string>((resolve) =>
      rl.question(
        "This will remove claudefy hooks, config, store, and backups. Continue? (y/N) ",
        resolve,
      ),
    );
    rl.close();
    return answer.toLowerCase() === "y";
  }
}
