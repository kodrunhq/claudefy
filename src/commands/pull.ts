import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { simpleGit } from "simple-git";
import { ConfigManager } from "../config/config-manager.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { PathMapper } from "../path-mapper/path-mapper.js";

import { Encryptor } from "../encryptor/encryptor.js";
import { Merger } from "../merger/merger.js";
import { BackupManager } from "../backup-manager/backup-manager.js";
import { output } from "../output.js";
import { STORE_CONFIG_DIR, STORE_UNKNOWN_DIR } from "../config/defaults.js";
import { Logger } from "../logger.js";
import { Lockfile } from "../lockfile.js";

export interface PullOptions {
  quiet: boolean;
  skipEncryption?: boolean;
  passphrase?: string;
  logger?: Logger;
}

export interface PullResult {
  overrideDetected: boolean;
  backupPath?: string;
  filesUpdated: number;
}

export class PullCommand {
  private homeDir: string;
  private claudeDir: string;
  private configManager: ConfigManager;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
    this.claudeDir = join(homeDir, ".claude");
    this.configManager = new ConfigManager(homeDir);
  }

  async execute(options: PullOptions): Promise<PullResult> {
    const config = await this.configManager.load();
    const result: PullResult = { overrideDetected: false, filesUpdated: 0 };
    const claudefyDir = join(this.homeDir, ".claudefy");
    const lockfile = new Lockfile(join(claudefyDir, "sync.lock"), {
      operation: "pull",
      retries: 3,
      retryDelayMs: 1000,
    });
    const log = options.logger;

    await log?.log("info", "pull", "Pull started");

    const acquired = await lockfile.acquire();
    if (!acquired) {
      const msg = "Another claudefy process is running. Pull skipped after retries.";
      await log?.log("warn", "pull", msg);
      throw new Error(msg);
    }

    try {
      return await this.executeInner(options, config, claudefyDir, result, log);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await log?.log("error", "pull", msg);
      throw err;
    } finally {
      await lockfile.release();
    }
  }

  private async executeInner(
    options: PullOptions,
    config: Awaited<ReturnType<ConfigManager["load"]>>,
    claudefyDir: string,
    result: PullResult,
    log: Logger | undefined,
  ): Promise<PullResult> {
    // 1. Initialize git adapter, switch to machine branch, pull & merge main
    const gitAdapter = new GitAdapter(claudefyDir);
    await gitAdapter.initStore(config.backend.url);
    await gitAdapter.ensureMachineBranch(config.machineId);
    try {
      await gitAdapter.pullAndMergeMain();
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      const msg = `Unable to pull from remote (may be fresh store): ${detail}`;
      await log?.log("warn", "pull", msg);
      if (!options.quiet) {
        output.info(msg);
      }
    }

    const storePath = gitAdapter.getStorePath();
    const resolvedClaudeDir = resolve(this.claudeDir);

    // 2. Check for override marker (check on main branch where overrides are written)
    const override = await this.checkOverrideOnMain(gitAdapter);
    if (override) {
      result.overrideDetected = true;
      await log?.log(
        "warn",
        "pull",
        `Override detected from machine: ${override.machine} at ${override.timestamp}`,
      );
      if (!options.quiet) {
        output.warn(`Override detected from machine: ${override.machine} at ${override.timestamp}`);
      }

      // Create backup before applying override (skip if .claude doesn't exist yet)
      if (existsSync(this.claudeDir)) {
        const backupManager = new BackupManager(claudefyDir);
        result.backupPath = await backupManager.createBackup(this.claudeDir, "pre-override");
      }

      if (result.backupPath) {
        await log?.log("info", "pull", `Backup created at: ${result.backupPath}`);
      }
      if (!options.quiet && result.backupPath) {
        output.info(`Backup created at: ${result.backupPath}`);
      }

      // Reset machine branch to main so we apply the override content
      const git = simpleGit(storePath);
      await git.reset(["--hard", "main"]);

      // Remove override marker and commit the acknowledgement locally.
      // The commit will be pushed on the next normal push.
      await gitAdapter.removeOverrideMarker();
      const gitCommit = simpleGit(storePath);
      await gitCommit.add(["."]);
      const status = await gitCommit.status();
      if (!status.isClean()) {
        await gitCommit.commit("acknowledge override marker removal");
      }
    }

    // 3. Create temp working directory
    const tmpDir = join(claudefyDir, ".pull-tmp");
    if (existsSync(tmpDir)) await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });

    const cleanup = () => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best effort
      }
      process.exit(1);
    };
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);

    try {
      // 4. Copy store to temp dir
      const storeConfigDir = join(storePath, STORE_CONFIG_DIR);
      const storeUnknownDir = join(storePath, STORE_UNKNOWN_DIR);
      const tmpConfigDir = join(tmpDir, "config");
      const tmpUnknownDir = join(tmpDir, "unknown");
      if (existsSync(storeConfigDir)) await cp(storeConfigDir, tmpConfigDir, { recursive: true });
      if (existsSync(storeUnknownDir))
        await cp(storeUnknownDir, tmpUnknownDir, { recursive: true });

      // Security: remove any symlinks nested inside subdirectories
      // (top-level symlinks are checked later, but cp() follows nested ones)
      await this.removeNestedSymlinks(tmpConfigDir);
      await this.removeNestedSymlinks(tmpUnknownDir);

      // 5. Decrypt any .age files in temp dir
      const encryptedFiles = await this.collectAgeFiles(tmpConfigDir, tmpUnknownDir);
      if (encryptedFiles.length > 0 && !options.skipEncryption) {
        if (!options.passphrase) {
          throw new Error(
            "Encrypted files found but no passphrase available. Set CLAUDEFY_PASSPHRASE or store it in your OS keychain via 'claudefy init'.",
          );
        }
        const encryptor = new Encryptor(options.passphrase, config.backend.url);
        if (existsSync(tmpConfigDir)) {
          await encryptor.decryptDirectory(tmpConfigDir);
        }
        if (existsSync(tmpUnknownDir)) {
          await encryptor.decryptDirectory(tmpUnknownDir);
        }
      }

      // 6. Remap paths (canonical -> local) in temp dir
      const links = await this.configManager.getLinks();
      const pathMapper = new PathMapper(links);

      // settings.json
      const remoteSettingsPath = join(tmpConfigDir, "settings.json");
      if (existsSync(remoteSettingsPath)) {
        let settings: Record<string, unknown>;
        try {
          settings = JSON.parse(await readFile(remoteSettingsPath, "utf-8"));
        } catch (err) {
          throw new Error(`Failed to parse settings.json: ${(err as Error).message}`, {
            cause: err,
          });
        }
        const remapped = pathMapper.remapSettingsPaths(settings, this.claudeDir);
        await writeFile(remoteSettingsPath, JSON.stringify(remapped, null, 2));
      }

      // installed_plugins.json
      const pluginsJsonPath = join(tmpConfigDir, "plugins", "installed_plugins.json");
      if (existsSync(pluginsJsonPath)) {
        let plugins: unknown;
        try {
          plugins = JSON.parse(await readFile(pluginsJsonPath, "utf-8"));
        } catch (err) {
          throw new Error(
            `Failed to parse plugins/installed_plugins.json: ${(err as Error).message}`,
            { cause: err },
          );
        }
        const remapped = pathMapper.remapPluginPaths(plugins, this.claudeDir);
        await writeFile(pluginsJsonPath, JSON.stringify(remapped, null, 2));
      }

      // known_marketplaces.json
      const marketplacesPath = join(tmpConfigDir, "plugins", "known_marketplaces.json");
      if (existsSync(marketplacesPath)) {
        let mp: unknown;
        try {
          mp = JSON.parse(await readFile(marketplacesPath, "utf-8"));
        } catch (err) {
          throw new Error(
            `Failed to parse plugins/known_marketplaces.json: ${(err as Error).message}`,
            { cause: err },
          );
        }
        const remapped = pathMapper.remapPluginPaths(mp, this.claudeDir);
        await writeFile(marketplacesPath, JSON.stringify(remapped, null, 2));
      }

      // history.jsonl
      const historyPath = join(tmpConfigDir, "history.jsonl");
      if (existsSync(historyPath)) {
        const content = await readFile(historyPath, "utf-8");
        const remapped =
          content
            .split("\n")
            .filter(Boolean)
            .map((line) => pathMapper.remapJsonlLine(line))
            .join("\n") + "\n";
        await writeFile(historyPath, remapped);
      }

      // projects/ directory renaming (canonical -> local)
      const projectsDir = join(tmpConfigDir, "projects");
      if (existsSync(projectsDir)) {
        const projectDirs = await readdir(projectsDir);
        for (const dirName of projectDirs) {
          const localName = pathMapper.remapDirName(dirName);
          if (localName) {
            const destPath = resolve(join(projectsDir, localName));
            // Path containment: ensure renamed dir stays within projects/
            const rel = relative(resolve(projectsDir), destPath);
            if (rel.startsWith("..") || resolve(destPath) === resolve(projectsDir)) {
              output.warn(
                `Skipping directory rename "${dirName}" -> "${localName}": path escapes projects directory`,
              );
              continue;
            }
            await rename(join(projectsDir, dirName), destPath);
          }
        }
      }

      // 7. Merge and copy to ~/.claude
      const merger = new Merger();
      await mkdir(this.claudeDir, { recursive: true });

      // 7a. Deep merge settings.json with hook filtering
      if (existsSync(remoteSettingsPath)) {
        const localSettingsPath = join(this.claudeDir, "settings.json");
        let remoteSettings: Record<string, unknown>;
        try {
          remoteSettings = JSON.parse(await readFile(remoteSettingsPath, "utf-8"));
        } catch (err) {
          throw new Error(`Failed to parse remote settings.json: ${(err as Error).message}`, {
            cause: err,
          });
        }

        // Security: strip keys that can execute code or modify permissions
        const DANGEROUS_KEYS = [
          "hooks",
          "mcpServers",
          "env",
          "permissions",
          "allowedTools",
          "apiKeyHelper",
        ];
        if (remoteSettings && typeof remoteSettings === "object") {
          for (const key of DANGEROUS_KEYS) {
            if (key in remoteSettings) {
              delete remoteSettings[key];
            }
          }
        }

        if (existsSync(localSettingsPath) && !result.overrideDetected) {
          let localSettings: Record<string, unknown>;
          try {
            localSettings = JSON.parse(await readFile(localSettingsPath, "utf-8"));
          } catch (err) {
            throw new Error(`Failed to parse local settings.json: ${(err as Error).message}`, {
              cause: err,
            });
          }
          const merged = merger.deepMergeJson(localSettings, remoteSettings);
          await writeFile(localSettingsPath, JSON.stringify(merged, null, 2));
        } else {
          await writeFile(localSettingsPath, JSON.stringify(remoteSettings, null, 2));
        }
        result.filesUpdated++;
      }

      // 7b. Copy remaining config items (remote overwrites local)
      if (existsSync(tmpConfigDir)) {
        const entries = await readdir(tmpConfigDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === "settings.json") continue; // Already handled

          // Security: skip symlinks to prevent path traversal attacks
          if (entry.isSymbolicLink()) {
            output.warn(`Skipping symlink in config store: ${entry.name}`);
            continue;
          }

          const src = join(tmpConfigDir, entry.name);
          const dest = resolve(join(this.claudeDir, entry.name));

          // Path containment: ensure destination stays within ~/.claude/
          const relPath = relative(resolvedClaudeDir, dest);
          if (relPath.startsWith("..") || resolve(dest) === resolvedClaudeDir) {
            output.warn(`Skipping "${entry.name}": resolved path escapes ~/.claude/`);
            continue;
          }

          await cp(src, dest, { recursive: true, force: true });
          result.filesUpdated++;
        }
      }

      // 7c. Copy unknown items back
      if (existsSync(tmpUnknownDir)) {
        const entries = await readdir(tmpUnknownDir, { withFileTypes: true });
        for (const entry of entries) {
          // Security: skip symlinks to prevent path traversal attacks
          if (entry.isSymbolicLink()) {
            output.warn(`Skipping symlink in unknown store: ${entry.name}`);
            continue;
          }

          const src = join(tmpUnknownDir, entry.name);
          const dest = resolve(join(this.claudeDir, entry.name));

          // Path containment: ensure destination stays within ~/.claude/
          const relPath = relative(resolvedClaudeDir, dest);
          if (relPath.startsWith("..") || resolve(dest) === resolvedClaudeDir) {
            output.warn(`Skipping "${entry.name}": resolved path escapes ~/.claude/`);
            continue;
          }

          await cp(src, dest, { recursive: true, force: true });
          result.filesUpdated++;
        }
      }
    } finally {
      if (existsSync(tmpDir)) await rm(tmpDir, { recursive: true, force: true });
      process.removeListener("SIGINT", cleanup);
      process.removeListener("SIGTERM", cleanup);
    }

    // NO re-encryption step (store is never modified)
    // NO commitAndPush (pull should not create commits)

    await log?.log(
      "info",
      "pull",
      `Pull complete. ${result.filesUpdated} items updated. override=${result.overrideDetected}`,
    );
    if (!options.quiet) {
      output.success(`Pull complete. ${result.filesUpdated} items updated.`);
    }

    return result;
  }

  /**
   * Check for an override marker. First checks current branch, then checks
   * the main branch (override markers may not survive merge into machine branch
   * due to conflicts from wipeAndPush).
   */
  private async checkOverrideOnMain(
    gitAdapter: GitAdapter,
  ): Promise<{ machine: string; timestamp: string } | null> {
    // First check on current branch (works when merge succeeded)
    const override = await gitAdapter.checkOverrideMarker();
    if (override) return override;

    // If not found, check on main branch by temporarily switching
    const currentBranch = await gitAdapter.getCurrentBranch();
    if (currentBranch === "main") return null;

    const storePath = gitAdapter.getStorePath();
    try {
      const git = simpleGit(storePath);
      // Use git show to read .override from main without switching branches
      const content = await git.show(["main:.override"]);
      const marker = JSON.parse(content);
      return { machine: marker.machine, timestamp: marker.timestamp };
    } catch {
      return null;
    }
  }

  private async removeNestedSymlinks(dir: string): Promise<void> {
    if (!existsSync(dir)) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        output.warn(`Removing nested symlink in store: ${entry.name}`);
        await rm(fullPath);
      } else if (entry.isDirectory()) {
        await this.removeNestedSymlinks(fullPath);
      }
    }
  }

  private async collectAgeFiles(...dirs: string[]): Promise<string[]> {
    const results: string[] = [];
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      await this.walkAgeFiles(dir, results);
    }
    return results;
  }

  private async walkAgeFiles(dirPath: string, results: string[]): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.walkAgeFiles(fullPath, results);
      } else if (entry.name.endsWith(".age")) {
        results.push(fullPath);
      }
    }
  }
}
