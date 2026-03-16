import { join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readdir, cp, rm, writeFile } from "node:fs/promises";
import { ConfigManager } from "../config/config-manager.js";
import { SyncFilter } from "../sync-filter/sync-filter.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { computeDiff } from "../diff-utils/diff-utils.js";
import type { DiffResult } from "../diff-utils/diff-utils.js";
import { output } from "../output.js";
import { STORE_CONFIG_DIR } from "../config/defaults.js";

export interface DiffOptions {
  quiet: boolean;
  push?: boolean;
  pull?: boolean;
  skipEncryption?: boolean;
  passphrase?: string;
}

interface DirectionResult {
  direction: "push" | "pull";
  diff: DiffResult;
}

export class DiffCommand {
  private readonly homeDir: string;
  private readonly claudeDir: string;
  private readonly configManager: ConfigManager;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
    this.claudeDir = join(homeDir, ".claude");
    this.configManager = new ConfigManager(homeDir);
  }

  async execute(options: DiffOptions): Promise<DirectionResult[]> {
    if (!this.configManager.isInitialized()) {
      throw new Error("Claudefy is not initialized. Run 'claudefy init' or 'claudefy join' first.");
    }

    const config = await this.configManager.load();
    const claudefyDir = join(this.homeDir, ".claudefy");

    const gitAdapter = new GitAdapter(claudefyDir);
    await gitAdapter.initStore(config.backend.url);
    await gitAdapter.ensureMachineBranch(config.machineId);
    try {
      await gitAdapter.pullAndMergeMain();
    } catch {
      // Fresh store or no remote
    }

    const storePath = gitAdapter.getStorePath();
    const storeConfigDir = join(storePath, STORE_CONFIG_DIR);

    // Build a temp directory with only allowlisted local files for comparison
    const tmpLocalDir = join(claudefyDir, ".diff-tmp");
    if (existsSync(tmpLocalDir)) await rm(tmpLocalDir, { recursive: true, force: true });
    await mkdir(tmpLocalDir, { recursive: true });

    try {
      // Copy allowlisted items from ~/.claude to temp dir
      if (existsSync(this.claudeDir)) {
        const syncFilterConfig = await this.configManager.getSyncFilter();
        const syncFilter = new SyncFilter(syncFilterConfig);
        const classification = await syncFilter.classify(this.claudeDir);

        for (const item of classification.allowlist) {
          const src = join(this.claudeDir, item.name);
          const dest = join(tmpLocalDir, item.name);
          if (existsSync(src)) {
            await cp(src, dest, { recursive: true });
          }
        }
      }

      const showPush = options.push || (!options.push && !options.pull);
      const showPull = options.pull || (!options.push && !options.pull);

      const results: DirectionResult[] = [];

      if (showPush) {
        const diff = await computeDiff(tmpLocalDir, storeConfigDir);
        results.push({ direction: "push", diff });
      }

      if (showPull) {
        const diff = await this.computePullDiff(storeConfigDir, tmpLocalDir);
        results.push({ direction: "pull", diff });
      }

      if (!options.quiet) {
        this.printResults(results);
      }

      const hasAnyChanges = results.some((r) => r.diff.hasChanges);
      if (hasAnyChanges) {
        process.exitCode = 1;
      }

      return results;
    } finally {
      if (existsSync(tmpLocalDir)) await rm(tmpLocalDir, { recursive: true, force: true });
    }
  }

  /**
   * Compute pull diff, handling .age files by stripping the .age suffix
   * and replacing their content with a placeholder so encrypted files
   * can be compared by logical name against local unencrypted files.
   */
  private async computePullDiff(storeDir: string, localDir: string): Promise<DiffResult> {
    // Create a temp copy of storeDir with .age suffixes stripped from names
    // so the diff compares logical file names rather than encrypted filenames.
    const tmpStoreDir = join(this.homeDir, ".claudefy", ".diff-store-tmp");
    if (existsSync(tmpStoreDir)) await rm(tmpStoreDir, { recursive: true, force: true });
    await mkdir(tmpStoreDir, { recursive: true });

    try {
      if (existsSync(storeDir)) {
        await cp(storeDir, tmpStoreDir, { recursive: true });
        await this.stripAgeExtensions(tmpStoreDir);
      }

      return await computeDiff(tmpStoreDir, localDir);
    } finally {
      if (existsSync(tmpStoreDir)) await rm(tmpStoreDir, { recursive: true, force: true });
    }
  }

  private async stripAgeExtensions(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.stripAgeExtensions(fullPath);
      } else if (entry.name.endsWith(".age")) {
        // Replace with a placeholder so the hash differs from any real file
        const baseName = entry.name.slice(0, -4);
        const newPath = join(dir, baseName);
        await rm(fullPath);
        await writeFile(newPath, `[encrypted content]`);
      }
    }
  }

  private printResults(results: DirectionResult[]): void {
    for (const { direction, diff } of results) {
      const label = direction === "push" ? "Push changes" : "Pull changes";

      if (!diff.hasChanges) {
        output.info(`${label}: no changes`);
        continue;
      }

      output.heading(`${label}:`);
      for (const file of diff.added) {
        output.success(`  Added:    ${file}`);
      }
      for (const file of diff.modified) {
        output.warn(`  Modified: ${file}`);
      }
      for (const file of diff.deleted) {
        output.error(`  Deleted:  ${file}`);
      }
    }
  }
}
