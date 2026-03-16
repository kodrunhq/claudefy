import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { existsSync } from "node:fs";
import { simpleGit } from "simple-git";
import { ConfigManager } from "../config/config-manager.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { PathMapper } from "../path-mapper/path-mapper.js";

import { Encryptor } from "../encryptor/encryptor.js";
import { Merger } from "../merger/merger.js";
import { BackupManager } from "../backup-manager/backup-manager.js";
import { output } from "../output.js";
import { STORE_CONFIG_DIR, STORE_UNKNOWN_DIR } from "../config/defaults.js";
import { Lockfile } from "../lockfile/lockfile.js";
import { ClaudeJsonSync } from "../claude-json-sync/claude-json-sync.js";

export interface PullOptions {
  quiet: boolean;
  skipEncryption?: boolean;
  passphrase?: string;
  only?: string;
  dryRun?: boolean;
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
    const claudefyDir = join(this.homeDir, ".claudefy");
    const lock = Lockfile.tryAcquire("pull", !!options.quiet, claudefyDir);
    if (!lock) return { overrideDetected: false, filesUpdated: 0 };
    try {
      return await this.executeLocked(options, claudefyDir);
    } finally {
      lock.release();
    }
  }

  private async executeLocked(options: PullOptions, claudefyDir: string): Promise<PullResult> {
    const config = await this.configManager.load();
    const result: PullResult = { overrideDetected: false, filesUpdated: 0 };
    const gitAdapter = new GitAdapter(claudefyDir);
    await gitAdapter.initStore(config.backend.url);
    await gitAdapter.ensureMachineBranch(config.machineId);
    try {
      await gitAdapter.pullAndMergeMain();
    } catch {
      // Fresh store with no remote history yet
    }

    const storePath = gitAdapter.getStorePath();
    const resolvedClaudeDir = resolve(this.claudeDir);

    // Dry-run: show what would be pulled without modifying anything
    if (options.dryRun) {
      const storeConfigDir = join(storePath, STORE_CONFIG_DIR);
      const { computeDiff } = await import("../diff-utils/diff-utils.js");
      const { cp, rm: rmTmp, mkdir: mkTmp } = await import("node:fs/promises");
      const tmpStore = join(claudefyDir, ".dryrun-store-tmp");
      const tmpLocal = join(claudefyDir, ".dryrun-local-tmp");
      if (existsSync(tmpStore)) await rmTmp(tmpStore, { recursive: true, force: true });
      if (existsSync(tmpLocal)) await rmTmp(tmpLocal, { recursive: true, force: true });
      await mkTmp(tmpStore, { recursive: true });
      await mkTmp(tmpLocal, { recursive: true });
      try {
        // Copy store config, stripping .age extensions
        if (existsSync(storeConfigDir)) {
          await cp(storeConfigDir, tmpStore, { recursive: true });
          await this.stripAgeExtensionsForDryRun(tmpStore);
        }
        // Copy allowlisted local files
        if (existsSync(this.claudeDir)) {
          const syncFilterConfig = await this.configManager.getSyncFilter();
          const { SyncFilter } = await import("../sync-filter/sync-filter.js");
          const syncFilter = new SyncFilter(syncFilterConfig);
          const classification = await syncFilter.classify(this.claudeDir);
          const filteredAllowlist = options.only
            ? classification.allowlist.filter((i) => i.name === options.only)
            : classification.allowlist;
          for (const item of filteredAllowlist) {
            const src = join(this.claudeDir, item.name);
            if (existsSync(src)) await cp(src, join(tmpLocal, item.name), { recursive: true });
          }
        }
        const diff = await computeDiff(tmpStore, tmpLocal);
        if (!diff.hasChanges) {
          if (!options.quiet) output.info("Dry run: no pull changes detected.");
        } else {
          if (!options.quiet) {
            output.heading("Dry run — pull would change:");
            for (const f of diff.added) output.success(`  Added:    ${f}`);
            for (const f of diff.modified) output.warn(`  Modified: ${f}`);
            for (const f of diff.deleted) output.error(`  Deleted:  ${f}`);
          }
          process.exitCode = 1;
        }
      } finally {
        if (existsSync(tmpStore)) await rmTmp(tmpStore, { recursive: true, force: true });
        if (existsSync(tmpLocal)) await rmTmp(tmpLocal, { recursive: true, force: true });
      }
      return result;
    }

    // 2. Check for override marker (check on main branch where overrides are written)
    const override = await this.checkOverrideOnMain(gitAdapter);
    if (override) {
      result.overrideDetected = true;
      if (!options.quiet) {
        output.warn(`Override detected from machine: ${override.machine} at ${override.timestamp}`);
      }

      // Create backup before applying override (skip if .claude doesn't exist yet)
      if (existsSync(this.claudeDir)) {
        const backupManager = new BackupManager(claudefyDir);
        result.backupPath = await backupManager.createBackup(this.claudeDir, "pre-override");
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

    let interruptedSignal: string | null = null;

    const onSignal = (signal: string) => {
      interruptedSignal = signal;
      process.once(signal, () => process.exit(128 + (signal === "SIGINT" ? 2 : 15)));
    };

    const sigintHandler = () => onSignal("SIGINT");
    const sigtermHandler = () => onSignal("SIGTERM");
    process.once("SIGINT", sigintHandler);
    process.once("SIGTERM", sigtermHandler);

    try {
      // Use do/while(false) so signal-interrupt checks can break out of the pipeline
      do {
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

        if (interruptedSignal) break;

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

        if (interruptedSignal) break;

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

        if (interruptedSignal) break;

        // 7. Merge and copy to ~/.claude
        const merger = new Merger();
        await mkdir(this.claudeDir, { recursive: true });

        // 7a. Deep merge settings.json with hook filtering
        if (existsSync(remoteSettingsPath) && (!options.only || options.only === "settings.json")) {
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

        if (interruptedSignal) break;

        // 7b. Copy remaining config items (remote overwrites local)
        if (existsSync(tmpConfigDir)) {
          const entries = await readdir(tmpConfigDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name === "settings.json") continue; // Already handled
            if (options.only && entry.name !== options.only) continue;

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

        if (interruptedSignal) break;

        // 7c. Copy unknown items back
        if (existsSync(tmpUnknownDir)) {
          const entries = await readdir(tmpUnknownDir, { withFileTypes: true });
          for (const entry of entries) {
            if (options.only && entry.name !== options.only) continue;

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
        // 8. Merge ~/.claude.json (if not interrupted)
        if (!interruptedSignal && config.claudeJson?.sync !== false) {
          const storeFile = join(tmpConfigDir, "claude-json-sync.json");
          if (existsSync(storeFile)) {
            const claudeJsonPath = join(this.homeDir, ".claude.json");
            const claudeJsonSync = new ClaudeJsonSync();
            const merged = claudeJsonSync.merge({
              claudeJsonPath,
              storePath: storeFile,
              homeDir: this.homeDir,
              syncMcpServers: config.claudeJson?.syncMcpServers ?? false,
            });
            // Write to target directly — renameSync fails across filesystems (EXDEV)
            // when ~/.claudefy and ~/.claude.json are on different mounts
            await writeFile(claudeJsonPath, JSON.stringify(merged, null, 2));
          }
        }
      } while (false); // eslint-disable-line no-constant-condition
    } finally {
      process.removeListener("SIGINT", sigintHandler);
      process.removeListener("SIGTERM", sigtermHandler);
      if (existsSync(tmpDir)) await rm(tmpDir, { recursive: true, force: true });
    }

    // NO re-encryption step (store is never modified)
    // NO commitAndPush (pull should not create commits)

    if (interruptedSignal) {
      // Re-raise the original signal so the process exits with the correct code (130/143)
      if (!options.quiet) {
        output.warn("Pull interrupted by signal.");
      }
      process.kill(process.pid, interruptedSignal);
      return result;
    }

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

  private async stripAgeExtensionsForDryRun(dir: string): Promise<void> {
    if (!existsSync(dir)) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.stripAgeExtensionsForDryRun(fullPath);
      } else if (entry.name.endsWith(".age")) {
        const baseName = entry.name.slice(0, -4);
        const newPath = join(dir, baseName);
        await rm(fullPath);
        await writeFile(newPath, "[encrypted content]");
      }
    }
  }
}
