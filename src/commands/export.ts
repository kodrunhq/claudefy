import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SyncFilter } from "../sync-filter/sync-filter.js";
import { ConfigManager } from "../config/config-manager.js";
import { output } from "../output.js";

const execFileAsync = promisify(execFile);

export interface ExportOptions {
  output: string;
  quiet?: boolean;
}

export class ExportCommand {
  private readonly homeDir: string;
  private readonly claudeDir: string;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
    this.claudeDir = join(homeDir, ".claude");
  }

  async execute(options: ExportOptions): Promise<void> {
    if (!existsSync(this.claudeDir)) {
      throw new Error("No ~/.claude directory found. Nothing to export.");
    }

    const configManager = new ConfigManager(this.homeDir);
    const syncFilterConfig = await configManager.getSyncFilter();
    const syncFilter = new SyncFilter(syncFilterConfig);
    const classification = await syncFilter.classify(this.claudeDir);

    // Collect files to export (allow + unknown, skip deny)
    const itemsToExport = [
      ...classification.allowlist.map((i) => i.name),
      ...classification.unknown.map((i) => i.name),
    ];

    if (itemsToExport.length === 0) {
      output.info("No files to export.");
      return;
    }

    try {
      await execFileAsync("tar", ["-czf", options.output, "-C", this.claudeDir, ...itemsToExport]);
    } catch (err) {
      throw new Error(`Failed to create export archive: ${(err as Error).message}`, { cause: err });
    }

    if (!options.quiet) {
      output.success(`Exported ${itemsToExport.length} items to ${options.output}`);
    }
  }
}
