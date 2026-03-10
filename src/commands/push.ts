import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { hostname, platform } from "node:os";
import { ConfigManager } from "../config/config-manager.js";
import { SyncFilter } from "../sync-filter/sync-filter.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { PathMapper } from "../path-mapper/path-mapper.js";
import { MachineRegistry } from "../machine-registry/machine-registry.js";
import { Encryptor } from "../encryptor/encryptor.js";
import { SecretScanner } from "../secret-scanner/scanner.js";
import { output } from "../output.js";

export interface PushOptions {
  quiet: boolean;
  skipEncryption?: boolean;
  skipSecretScan?: boolean;
  passphrase?: string;
}

export class PushCommand {
  private homeDir: string;
  private claudeDir: string;
  private configManager: ConfigManager;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
    this.claudeDir = join(homeDir, ".claude");
    this.configManager = new ConfigManager(homeDir);
  }

  async execute(options: PushOptions): Promise<void> {
    const config = await this.configManager.load();
    const syncFilterConfig = await this.configManager.getSyncFilter();
    const syncFilter = new SyncFilter(syncFilterConfig);

    // 1. Classify ~/.claude contents
    if (!existsSync(this.claudeDir)) {
      throw new Error(`No ${this.claudeDir} directory found. Nothing to push.`);
    }
    const classification = await syncFilter.classify(this.claudeDir);

    const willEncrypt = config.encryption.enabled && !options.skipEncryption;
    if (!options.quiet) {
      const unknownLabel = willEncrypt ? "unknown (encrypted)" : "unknown";
      output.info(
        `Syncing: ${classification.allowlist.length} allowed, ` +
          `${classification.unknown.length} ${unknownLabel}, ` +
          `${classification.denylist.length} denied`,
      );
    }

    // 2. Initialize git adapter
    const gitAdapter = new GitAdapter(join(this.homeDir, ".claudefy"));
    await gitAdapter.initStore(config.backend.url);
    try {
      await gitAdapter.pull();
    } catch {
      // Fresh store with no remote history yet — safe to continue
    }

    const storePath = gitAdapter.getStorePath();
    const configDir = join(storePath, "config");
    const unknownDir = join(storePath, "unknown");

    // 3. Clean existing config and unknown dirs in store
    if (existsSync(configDir)) {
      await rm(configDir, { recursive: true });
    }
    if (existsSync(unknownDir)) {
      await rm(unknownDir, { recursive: true });
    }
    await mkdir(configDir, { recursive: true });
    await mkdir(unknownDir, { recursive: true });

    // 4. Copy allowlisted items
    for (const item of classification.allowlist) {
      const src = join(this.claudeDir, item.name);
      const dest = join(configDir, item.name);
      await cp(src, dest, { recursive: true });
    }

    // 5. Copy unknown items
    for (const item of classification.unknown) {
      const src = join(this.claudeDir, item.name);
      const dest = join(unknownDir, item.name);
      await cp(src, dest, { recursive: true });
    }

    // 6. Normalize paths in known files
    const links = await this.configManager.getLinks();
    const pathMapper = new PathMapper(links);

    // settings.json
    const settingsPath = join(configDir, "settings.json");
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
      const normalized = pathMapper.normalizeSettingsPaths(settings, this.claudeDir);
      await writeFile(settingsPath, JSON.stringify(normalized, null, 2));
    }

    // installed_plugins.json
    const pluginsJsonPath = join(configDir, "plugins", "installed_plugins.json");
    if (existsSync(pluginsJsonPath)) {
      const plugins = JSON.parse(await readFile(pluginsJsonPath, "utf-8"));
      const normalized = pathMapper.normalizePluginPaths(plugins, this.claudeDir);
      await writeFile(pluginsJsonPath, JSON.stringify(normalized, null, 2));
    }

    // known_marketplaces.json
    const marketplacesPath = join(configDir, "plugins", "known_marketplaces.json");
    if (existsSync(marketplacesPath)) {
      const mp = JSON.parse(await readFile(marketplacesPath, "utf-8"));
      const normalized = pathMapper.normalizePluginPaths(mp, this.claudeDir);
      await writeFile(marketplacesPath, JSON.stringify(normalized, null, 2));
    }

    // history.jsonl
    const historyPath = join(configDir, "history.jsonl");
    if (existsSync(historyPath)) {
      const content = await readFile(historyPath, "utf-8");
      const normalized =
        content
          .split("\n")
          .filter(Boolean)
          .map((line) => pathMapper.normalizeJsonlLine(line))
          .join("\n") + "\n";
      await writeFile(historyPath, normalized);
    }

    // projects/ directory renaming
    const projectsDir = join(configDir, "projects");
    if (existsSync(projectsDir)) {
      const projectDirs = await readdir(projectsDir);
      for (const dirName of projectDirs) {
        const canonicalId = pathMapper.normalizeDirName(dirName);
        if (canonicalId) {
          await rename(join(projectsDir, dirName), join(projectsDir, canonicalId));
        }
      }
    }

    // 7. Scan for secrets before committing
    if (!options.skipSecretScan) {
      const scanner = new SecretScanner();
      const filesToScan = await this.collectFiles(configDir);
      const unknownFiles = await this.collectFiles(unknownDir);
      filesToScan.push(...unknownFiles);
      const findings = await scanner.scanFiles(filesToScan);
      if (findings.length > 0) {
        const details = findings.map((f) => `  ${f.file}:${f.line} [${f.pattern}]`).join("\n");
        throw new Error(
          `Secret scan detected ${findings.length} potential secret(s):\n${details}\n\nAborting push. Use --skip-secret-scan to bypass scanning.`,
        );
      }
    }

    // 8. Encrypt files if encryption is enabled
    if (config.encryption.enabled && !options.skipEncryption) {
      if (!options.passphrase) {
        throw new Error("Encryption is enabled but CLAUDEFY_PASSPHRASE env var is not set.");
      }
      const encryptor = new Encryptor(options.passphrase);

      // Encrypt sensitive config files
      const filesToEncrypt = ["settings.json", "history.jsonl"];
      for (const fileName of filesToEncrypt) {
        const filePath = join(configDir, fileName);
        if (existsSync(filePath)) {
          await encryptor.encryptFile(filePath, filePath + ".age");
          await rm(filePath);
        }
      }

      // Encrypt all files in unknown/
      if (existsSync(unknownDir)) {
        await encryptor.encryptDirectory(unknownDir);
      }
    }

    // 9. Update machine registry
    const registry = new MachineRegistry(join(storePath, "manifest.json"));
    await registry.register(config.machineId, hostname(), platform());

    // 10. Commit and push
    await gitAdapter.commitAndPush(`sync: push from ${config.machineId}`);

    if (!options.quiet) {
      output.success("Push complete.");
    }
  }

  private async collectFiles(dirPath: string): Promise<string[]> {
    if (!existsSync(dirPath)) return [];
    const results: string[] = [];
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.collectFiles(fullPath)));
      } else {
        results.push(fullPath);
      }
    }
    return results;
  }

}
