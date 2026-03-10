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

    // 1. Initialize git adapter and pull
    const claudefyDir = join(this.homeDir, ".claudefy");
    const gitAdapter = new GitAdapter(claudefyDir);
    await gitAdapter.initStore(config.backend.url);
    try {
      await gitAdapter.pull();
    } catch {
      // Fresh store with no remote history yet
    }

    const storePath = gitAdapter.getStorePath();
    const configDir = join(storePath, "config");
    const unknownDir = join(storePath, "unknown");
    const resolvedClaudeDir = resolve(this.claudeDir);

    // 2. Check for override marker
    const override = await gitAdapter.checkOverrideMarker();
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

      // Remove override marker
      await gitAdapter.removeOverrideMarker();
      await gitAdapter.commitAndPush("pull: acknowledge override");
    }

    // 3. Decrypt .age files if encryption is enabled
    if (config.encryption.enabled && !options.skipEncryption) {
      if (!options.passphrase) {
        throw new Error("Encryption is enabled but CLAUDEFY_PASSPHRASE env var is not set.");
      }

      const encryptor = new Encryptor(options.passphrase);

      // Decrypt sensitive config files
      const filesToDecrypt = ["settings.json.age", "history.jsonl.age"];
      for (const fileName of filesToDecrypt) {
        const filePath = join(configDir, fileName);
        if (existsSync(filePath)) {
          const outputPath = filePath.replace(/\.age$/, "");
          await encryptor.decryptFile(filePath, outputPath);
          await rm(filePath);
        }
      }

      // Decrypt all .age files in unknown/
      if (existsSync(unknownDir)) {
        await encryptor.decryptDirectory(unknownDir);
      }
    }

    // 4. Remap paths (canonical → local)
    const links = await this.configManager.getLinks();
    const pathMapper = new PathMapper(links);

    // settings.json
    const remoteSettingsPath = join(configDir, "settings.json");
    if (existsSync(remoteSettingsPath)) {
      const settings = JSON.parse(await readFile(remoteSettingsPath, "utf-8"));
      const remapped = pathMapper.remapSettingsPaths(settings, this.claudeDir);
      await writeFile(remoteSettingsPath, JSON.stringify(remapped, null, 2));
    }

    // installed_plugins.json
    const pluginsJsonPath = join(configDir, "plugins", "installed_plugins.json");
    if (existsSync(pluginsJsonPath)) {
      const plugins = JSON.parse(await readFile(pluginsJsonPath, "utf-8"));
      const remapped = pathMapper.remapPluginPaths(plugins, this.claudeDir);
      await writeFile(pluginsJsonPath, JSON.stringify(remapped, null, 2));
    }

    // known_marketplaces.json
    const marketplacesPath = join(configDir, "plugins", "known_marketplaces.json");
    if (existsSync(marketplacesPath)) {
      const mp = JSON.parse(await readFile(marketplacesPath, "utf-8"));
      const remapped = pathMapper.remapPluginPaths(mp, this.claudeDir);
      await writeFile(marketplacesPath, JSON.stringify(remapped, null, 2));
    }

    // history.jsonl
    const historyPath = join(configDir, "history.jsonl");
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

    // projects/ directory renaming (canonical → local)
    const projectsDir = join(configDir, "projects");
    if (existsSync(projectsDir)) {
      const projectDirs = await readdir(projectsDir);
      for (const dirName of projectDirs) {
        const localName = pathMapper.remapDirName(dirName);
        if (localName) {
          const destPath = resolve(join(projectsDir, localName));
          // Path containment: ensure renamed dir stays within projects/
          if (!destPath.startsWith(resolve(projectsDir) + "/")) {
            console.warn(
              `Skipping directory rename "${dirName}" → "${localName}": path escapes projects directory`,
            );
            continue;
          }
          await rename(join(projectsDir, dirName), destPath);
        }
      }
    }

    // 5. Merge and copy to ~/.claude
    const merger = new Merger();
    await mkdir(this.claudeDir, { recursive: true });

    // 5a. Deep merge settings.json
    if (existsSync(remoteSettingsPath)) {
      const localSettingsPath = join(this.claudeDir, "settings.json");
      const remoteSettings = JSON.parse(await readFile(remoteSettingsPath, "utf-8"));

      // Security: strip hooks from remote settings to prevent remote hook injection.
      // Local hooks should never be overwritten by remote data, as an attacker with
      // store access could inject arbitrary shell commands via SessionStart/SessionEnd hooks.
      delete remoteSettings.hooks;

      if (existsSync(localSettingsPath) && !result.overrideDetected) {
        const localSettings = JSON.parse(await readFile(localSettingsPath, "utf-8"));
        const merged = merger.deepMergeJson(localSettings, remoteSettings);
        await writeFile(localSettingsPath, JSON.stringify(merged, null, 2));
      } else {
        await writeFile(localSettingsPath, JSON.stringify(remoteSettings, null, 2));
      }
      result.filesUpdated++;
    }

    // 5b. Copy remaining config items (remote overwrites local)
    if (existsSync(configDir)) {
      const entries = await readdir(configDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "settings.json") continue; // Already handled

        // Security: skip symlinks to prevent path traversal attacks
        if (entry.isSymbolicLink()) {
          console.warn(`Skipping symlink in config store: ${entry.name}`);
          continue;
        }

        const src = join(configDir, entry.name);
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

    // 5c. Copy unknown items back
    if (existsSync(unknownDir)) {
      const entries = await readdir(unknownDir, { withFileTypes: true });
      for (const entry of entries) {
        // Security: skip symlinks to prevent path traversal attacks
        if (entry.isSymbolicLink()) {
          console.warn(`Skipping symlink in unknown store: ${entry.name}`);
          continue;
        }

        const src = join(unknownDir, entry.name);
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

    // 6. Re-encrypt decrypted files in the store before committing,
    //    so plaintext is never committed to git history.
    if (config.encryption.enabled && !options.skipEncryption) {
      const encryptor = new Encryptor(options.passphrase!);

      const filesToReencrypt = ["settings.json", "history.jsonl"];
      for (const fileName of filesToReencrypt) {
        const filePath = join(configDir, fileName);
        if (existsSync(filePath)) {
          await encryptor.encryptFile(filePath, filePath + ".age");
          await rm(filePath);
        }
      }

      // Re-encrypt all plaintext files in unknown/
      if (existsSync(unknownDir)) {
        await encryptor.encryptDirectory(unknownDir);
      }
    }

    // 7. Update machine registry last sync time and commit
    const registry = new MachineRegistry(join(storePath, "manifest.json"));
    await registry.updateLastSync(config.machineId);
    await gitAdapter.commitAndPush(`sync: pull on ${config.machineId}`);

    if (!options.quiet) {
      output.success(`Pull complete. ${result.filesUpdated} items updated.`);
    }

    return result;
  }

}
