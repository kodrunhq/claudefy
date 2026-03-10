import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { ConfigManager } from "../config/config-manager.js";
import { SyncFilter } from "../sync-filter/sync-filter.js";

export interface StatusResult {
  initialized: boolean;
  machineId?: string;
  backendUrl?: string;
  localFiles: string[];
  syncedFiles: string[];
  deniedFiles: string[];
  unknownFiles: string[];
}

export class StatusCommand {
  private homeDir: string;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
  }

  async execute(): Promise<StatusResult> {
    const configManager = new ConfigManager(this.homeDir);

    if (!configManager.isInitialized()) {
      return {
        initialized: false,
        localFiles: [],
        syncedFiles: [],
        deniedFiles: [],
        unknownFiles: [],
      };
    }

    const config = await configManager.load();
    const claudeDir = join(this.homeDir, ".claude");

    if (!existsSync(claudeDir)) {
      return {
        initialized: true,
        machineId: config.machineId,
        backendUrl: config.backend.url,
        localFiles: [],
        syncedFiles: [],
        deniedFiles: [],
        unknownFiles: [],
      };
    }

    const syncFilterConfig = await configManager.getSyncFilter();
    const syncFilter = new SyncFilter(syncFilterConfig);
    const localFiles = await readdir(claudeDir);
    const classification = await syncFilter.classify(claudeDir);

    return {
      initialized: true,
      machineId: config.machineId,
      backendUrl: config.backend.url,
      localFiles,
      syncedFiles: classification.allowlist.map((i) => i.name),
      deniedFiles: classification.denylist.map((i) => i.name),
      unknownFiles: classification.unknown.map((i) => i.name),
    };
  }
}
