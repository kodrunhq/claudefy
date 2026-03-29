import { readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import type { SyncFilterConfig } from "../config/types.js";
import type { SyncTier, ClassifiedItem, ClassificationResult } from "./types.js";

// Items that are always denied regardless of user configuration.
// These contain sensitive credentials and must never be synced.
const HARDCODED_DENYLIST = [".credentials.json", "settings.local.json"];

export class SyncFilter {
  private config: SyncFilterConfig;

  constructor(config: SyncFilterConfig) {
    this.config = config;
  }

  async classify(claudeDir: string): Promise<ClassificationResult> {
    const entries = await readdir(claudeDir, { withFileTypes: true });

    const settled = await Promise.all(
      entries.map(async (entry) => {
        const tier = this.getTier(entry.name);
        const fullPath = join(claudeDir, entry.name);
        try {
          const stats = await lstat(fullPath);
          return {
            name: entry.name,
            tier,
            isDirectory: entry.isDirectory(),
            sizeBytes: stats.size,
          } satisfies ClassifiedItem;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            // File removed between readdir and lstat — skip it
            return null;
          }
          throw err;
        }
      }),
    );

    const items: ClassifiedItem[] = settled.filter((item): item is ClassifiedItem => item !== null);

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
