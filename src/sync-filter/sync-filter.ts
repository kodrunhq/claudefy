import { readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import type { SyncFilterConfig } from "../config/types.js";
import type { SyncTier, ClassifiedItem, ClassificationResult } from "./types.js";

// Items that are always denied regardless of user configuration.
// These contain sensitive credentials and must never be synced.
const HARDCODED_DENYLIST = [".credentials.json"];

export class SyncFilter {
  private config: SyncFilterConfig;

  constructor(config: SyncFilterConfig) {
    this.config = config;
  }

  async classify(claudeDir: string): Promise<ClassificationResult> {
    const entries = await readdir(claudeDir, { withFileTypes: true });
    const items: ClassifiedItem[] = [];

    for (const entry of entries) {
      const tier = this.getTier(entry.name);
      const fullPath = join(claudeDir, entry.name);
      const stats = await lstat(fullPath);

      items.push({
        name: entry.name,
        tier,
        isDirectory: entry.isDirectory(),
        sizeBytes: stats.size,
      });
    }

    return {
      items,
      allowlist: items.filter((i) => i.tier === "allow"),
      denylist: items.filter((i) => i.tier === "deny"),
      unknown: items.filter((i) => i.tier === "unknown"),
    };
  }

  getTier(name: string): SyncTier {
    if (HARDCODED_DENYLIST.includes(name)) return "deny";
    if (this.config.allowlist.includes(name)) return "allow";
    if (this.config.denylist.includes(name)) return "deny";
    return "unknown";
  }
}
