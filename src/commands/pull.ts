import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { ConfigManager } from "../config/config-manager.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { PathMapper } from "../path-mapper/path-mapper.js";
import { MachineRegistry } from "../machine-registry/machine-registry.js";
import { Encryptor } from "../encryptor/encryptor.js";
import { Merger } from "../merger/merger.js";
import { BackupManager } from "../backup-manager/backup-manager.js";

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

    // 2. Check for override marker
    const override = await gitAdapter.checkOverrideMarker();
    if (override) {
      result.overrideDetected = true;
      if (!options.quiet) {
        console.log(`Override detected from machine: ${override.machine} at ${override.timestamp}`);
      }

      // Create backup before applying override
      const backupManager = new BackupManager(claudefyDir);
      result.backupPath = await backupManager.createBackup(this.claudeDir, "pre-override");

      if (!options.quiet) {
        console.log(`Backup created at: ${result.backupPath}`);
      }

      // Remove override marker
      await gitAdapter.removeOverrideMarker();
      await gitAdapter.commitAndPush("pull: acknowledge override");
    }

    // 3. Decrypt .age files if encryption is enabled
    if (config.encryption.enabled && !options.skipEncryption && options.passphrase) {
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
        await this.decryptDirectory(encryptor, unknownDir);
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
      const remapped = content
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
          await rename(join(projectsDir, dirName), join(projectsDir, localName));
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

      if (existsSync(localSettingsPath) && !result.overrideDetected) {
        const localSettings = JSON.parse(await readFile(localSettingsPath, "utf-8"));
        const merged = merger.deepMergeJson(localSettings, remoteSettings);
        await writeFile(localSettingsPath, JSON.stringify(merged, null, 2));
      } else {
        await writeFile(localSettingsPath, JSON.stringify(remoteSettings, null, 2));
      }
      result.filesUpdated++;
    }

    // 5b. Copy remaining config items (overwrite / LWW)
    if (existsSync(configDir)) {
      const entries = await readdir(configDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "settings.json") continue; // Already handled
        const src = join(configDir, entry.name);
        const dest = join(this.claudeDir, entry.name);
        await cp(src, dest, { recursive: true, force: true });
        result.filesUpdated++;
      }
    }

    // 5c. Copy unknown items back
    if (existsSync(unknownDir)) {
      const entries = await readdir(unknownDir, { withFileTypes: true });
      for (const entry of entries) {
        const src = join(unknownDir, entry.name);
        const dest = join(this.claudeDir, entry.name);
        await cp(src, dest, { recursive: true, force: true });
        result.filesUpdated++;
      }
    }

    // 6. Update machine registry last sync time
    const registry = new MachineRegistry(join(storePath, "manifest.json"));
    await registry.updateLastSync(config.machineId);

    if (!options.quiet) {
      console.log(`Pull complete. ${result.filesUpdated} items updated.`);
    }

    return result;
  }

  private async decryptDirectory(encryptor: Encryptor, dirPath: string): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.decryptDirectory(encryptor, fullPath);
      } else if (entry.name.endsWith(".age")) {
        const outputPath = fullPath.replace(/\.age$/, "");
        await encryptor.decryptFile(fullPath, outputPath);
        await rm(fullPath);
      }
    }
  }
}
