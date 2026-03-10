import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { ConfigManager } from "../config/config-manager.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { PathMapper } from "../path-mapper/path-mapper.js";
import { MachineRegistry } from "../machine-registry/machine-registry.js";
import { Encryptor } from "../encryptor/encryptor.js";
import { Merger } from "../merger/merger.js";
import { BackupManager } from "../backup-manager/backup-manager.js";
import { output } from "../output.js";

export interface PullOptions {
  quiet: boolean;
  skipEncryption?: boolean;
  passphrase?: string;
}

export interface PullResult {
  overrideDetected: boolean;
  backupPath?: string;
  filesUpdated: number;
}

function isClaudefyHook(hookEntry: { hooks?: Array<{ command?: string }> }): boolean {
  if (!Array.isArray(hookEntry.hooks)) return false;
  return hookEntry.hooks.some((h) => {
    const command = typeof h.command === "string" ? h.command.trim() : "";
    return command.startsWith("claudefy pull") || command.startsWith("claudefy push");
  });
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

    // 1. Initialize git adapter, switch to machine branch, pull & merge main
    const claudefyDir = join(this.homeDir, ".claudefy");
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
      const { simpleGit: sg } = await import("simple-git");
      const git = sg(storePath);
      await git.reset(["--hard", "main"]);

      // Remove override marker on current branch
      await gitAdapter.removeOverrideMarker();
    }

    // 3. Create temp working directory
    const tmpDir = join(claudefyDir, ".pull-tmp");
    if (existsSync(tmpDir)) await rm(tmpDir, { recursive: true });
    await mkdir(tmpDir, { recursive: true });

    try {
      // 4. Copy store to temp dir
      const storeConfigDir = join(storePath, "config");
      const storeUnknownDir = join(storePath, "unknown");
      const tmpConfigDir = join(tmpDir, "config");
      const tmpUnknownDir = join(tmpDir, "unknown");
      if (existsSync(storeConfigDir)) await cp(storeConfigDir, tmpConfigDir, { recursive: true });
      if (existsSync(storeUnknownDir)) await cp(storeUnknownDir, tmpUnknownDir, { recursive: true });

      // 5. Decrypt any .age files in temp dir
      const encryptedFiles = await this.collectAgeFiles(tmpConfigDir, tmpUnknownDir);
      if (encryptedFiles.length > 0) {
        if (!options.passphrase) {
          throw new Error(
            "Encrypted files found but no passphrase available. Set CLAUDEFY_PASSPHRASE or store it in your OS keychain via 'claudefy init'.",
          );
        }
        const encryptor = new Encryptor(options.passphrase);
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
        const settings = JSON.parse(await readFile(remoteSettingsPath, "utf-8"));
        const remapped = pathMapper.remapSettingsPaths(settings, this.claudeDir);
        await writeFile(remoteSettingsPath, JSON.stringify(remapped, null, 2));
      }

      // installed_plugins.json
      const pluginsJsonPath = join(tmpConfigDir, "plugins", "installed_plugins.json");
      if (existsSync(pluginsJsonPath)) {
        const plugins = JSON.parse(await readFile(pluginsJsonPath, "utf-8"));
        const remapped = pathMapper.remapPluginPaths(plugins, this.claudeDir);
        await writeFile(pluginsJsonPath, JSON.stringify(remapped, null, 2));
      }

      // known_marketplaces.json
      const marketplacesPath = join(tmpConfigDir, "plugins", "known_marketplaces.json");
      if (existsSync(marketplacesPath)) {
        const mp = JSON.parse(await readFile(marketplacesPath, "utf-8"));
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
            if (!destPath.startsWith(resolve(projectsDir) + "/")) {
              console.warn(
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
        const remoteSettings = JSON.parse(await readFile(remoteSettingsPath, "utf-8"));

        // Security: filter out claudefy-managed hooks but preserve user hooks
        if (remoteSettings.hooks) {
          for (const event of Object.keys(remoteSettings.hooks)) {
            if (!Array.isArray(remoteSettings.hooks[event])) continue;
            remoteSettings.hooks[event] = remoteSettings.hooks[event].filter(
              (h: any) => !isClaudefyHook(h),
            );
            if (remoteSettings.hooks[event].length === 0) {
              delete remoteSettings.hooks[event];
            }
          }
          if (Object.keys(remoteSettings.hooks).length === 0) {
            delete remoteSettings.hooks;
          }
        }

        if (existsSync(localSettingsPath) && !result.overrideDetected) {
          const localSettings = JSON.parse(await readFile(localSettingsPath, "utf-8"));
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
            console.warn(`Skipping symlink in config store: ${entry.name}`);
            continue;
          }

          const src = join(tmpConfigDir, entry.name);
          const dest = resolve(join(this.claudeDir, entry.name));

          // Path containment: ensure destination stays within ~/.claude/
          if (!dest.startsWith(resolvedClaudeDir + "/") && dest !== resolvedClaudeDir) {
            console.warn(`Skipping "${entry.name}": resolved path escapes ~/.claude/`);
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
            console.warn(`Skipping symlink in unknown store: ${entry.name}`);
            continue;
          }

          const src = join(tmpUnknownDir, entry.name);
          const dest = resolve(join(this.claudeDir, entry.name));

          // Path containment: ensure destination stays within ~/.claude/
          if (!dest.startsWith(resolvedClaudeDir + "/") && dest !== resolvedClaudeDir) {
            console.warn(`Skipping "${entry.name}": resolved path escapes ~/.claude/`);
            continue;
          }

          await cp(src, dest, { recursive: true, force: true });
          result.filesUpdated++;
        }
      }
    } finally {
      if (existsSync(tmpDir)) await rm(tmpDir, { recursive: true });
    }

    // NO re-encryption step (store is never modified)
    // NO commitAndPush (pull should not create commits)

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
  private async checkOverrideOnMain(gitAdapter: GitAdapter): Promise<{ machine: string; timestamp: string } | null> {
    // First check on current branch (works when merge succeeded)
    const override = await gitAdapter.checkOverrideMarker();
    if (override) return override;

    // If not found, check on main branch by temporarily switching
    const currentBranch = await gitAdapter.getCurrentBranch();
    if (currentBranch === "main") return null;

    const storePath = gitAdapter.getStorePath();
    const overridePath = join(storePath, ".override");

    try {
      const { simpleGit } = await import("simple-git");
      const git = simpleGit(storePath);
      // Use git show to read .override from main without switching branches
      const content = await git.show(["main:.override"]);
      const marker = JSON.parse(content);
      return { machine: marker.machine, timestamp: marker.timestamp };
    } catch {
      return null;
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
