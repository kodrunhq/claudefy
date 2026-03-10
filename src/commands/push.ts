import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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

    // 2. Initialize git adapter + per-machine branch
    const gitAdapter = new GitAdapter(join(this.homeDir, ".claudefy"));
    await gitAdapter.initStore(config.backend.url);
    await gitAdapter.ensureMachineBranch(config.machineId);
    try {
      await gitAdapter.pullAndMergeMain();
    } catch {
      if (!options.quiet) {
        output.info(
          "Warning: Unable to pull latest changes from remote; proceeding with local state only.",
        );
      }
    }

    const storePath = gitAdapter.getStorePath();
    const stagingDir = join(storePath, ".staging");
    const configDir = join(storePath, "config");
    const unknownDir = join(storePath, "unknown");

    try {
      // 3. Clean staging dir
      if (existsSync(stagingDir)) await rm(stagingDir, { recursive: true });
      await mkdir(join(stagingDir, "config"), { recursive: true });
      await mkdir(join(stagingDir, "unknown"), { recursive: true });

      // 4. Copy allowlisted items to staging
      for (const item of classification.allowlist) {
        const src = join(this.claudeDir, item.name);
        const dest = join(stagingDir, "config", item.name);
        await cp(src, dest, { recursive: true });
      }

      // 5. Copy unknown items to staging
      for (const item of classification.unknown) {
        const src = join(this.claudeDir, item.name);
        const dest = join(stagingDir, "unknown", item.name);
        await cp(src, dest, { recursive: true });
      }

      // 6. Normalize paths in staging
      const links = await this.configManager.getLinks();
      const pathMapper = new PathMapper(links);

      // settings.json
      const settingsPath = join(stagingDir, "config", "settings.json");
      if (existsSync(settingsPath)) {
        const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
        const normalized = pathMapper.normalizeSettingsPaths(settings, this.claudeDir);
        await writeFile(settingsPath, JSON.stringify(normalized, null, 2));
      }

      // installed_plugins.json
      const pluginsJsonPath = join(stagingDir, "config", "plugins", "installed_plugins.json");
      if (existsSync(pluginsJsonPath)) {
        const plugins = JSON.parse(await readFile(pluginsJsonPath, "utf-8"));
        const normalized = pathMapper.normalizePluginPaths(plugins, this.claudeDir);
        await writeFile(pluginsJsonPath, JSON.stringify(normalized, null, 2));
      }

      // known_marketplaces.json
      const marketplacesPath = join(stagingDir, "config", "plugins", "known_marketplaces.json");
      if (existsSync(marketplacesPath)) {
        const mp = JSON.parse(await readFile(marketplacesPath, "utf-8"));
        const normalized = pathMapper.normalizePluginPaths(mp, this.claudeDir);
        await writeFile(marketplacesPath, JSON.stringify(normalized, null, 2));
      }

      // history.jsonl
      const historyPath = join(stagingDir, "config", "history.jsonl");
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

      // projects/ directory renaming with path traversal check
      const projectsDir = join(stagingDir, "config", "projects");
      if (existsSync(projectsDir)) {
        const projectDirs = await readdir(projectsDir);
        for (const dirName of projectDirs) {
          const canonicalId = pathMapper.normalizeDirName(dirName);
          if (canonicalId) {
            const destPath = resolve(join(projectsDir, canonicalId));
            if (!destPath.startsWith(resolve(projectsDir) + "/")) {
              output.warn(`Skipping directory rename "${dirName}": path escapes projects directory`);
              continue;
            }
            await rename(join(projectsDir, dirName), destPath);
          }
        }
      }

      // 7. Scan for secrets and encrypt files that contain them (in staging)
      if (!options.skipSecretScan) {
        const scanner = new SecretScanner();
        const allFiles = [
          ...(await this.collectFiles(join(stagingDir, "config"))),
          ...(await this.collectFiles(join(stagingDir, "unknown"))),
        ];
        const findings = await scanner.scanFiles(allFiles);

        if (findings.length > 0) {
          if (!config.encryption.enabled || options.skipEncryption) {
            const details = findings.map((f) => `  ${f.file}:${f.line} [${f.pattern}]`).join("\n");
            throw new Error(
              `Secret scan detected ${findings.length} potential secret(s):\n${details}\n\nEnable encryption or use --skip-secret-scan to bypass scanning.`,
            );
          }
          if (!options.passphrase) {
            throw new Error(
              "Secrets detected and encryption is enabled but no passphrase found. Set CLAUDEFY_PASSPHRASE or store it in your OS keychain via 'claudefy init'.",
            );
          }

          const encryptor = new Encryptor(options.passphrase);
          const filesToEncrypt = new Set(findings.map((f) => f.file));
          for (const filePath of filesToEncrypt) {
            if (existsSync(filePath) && !filePath.endsWith(".age")) {
              await encryptor.encryptFile(filePath, filePath + ".age");
              await rm(filePath);
            }
          }

          if (!options.quiet) {
            output.info(`Encrypted ${filesToEncrypt.size} file(s) containing potential secrets.`);
          }
        }
      }

      // 8. Swap staging into real dirs
      if (existsSync(configDir)) await rm(configDir, { recursive: true });
      if (existsSync(unknownDir)) await rm(unknownDir, { recursive: true });
      await rename(join(stagingDir, "config"), configDir);
      await rename(join(stagingDir, "unknown"), unknownDir);
    } finally {
      if (existsSync(stagingDir)) await rm(stagingDir, { recursive: true });
    }

    // 9. Conditional manifest update
    const hasRealChanges = !(await gitAdapter.isClean());
    const registry = new MachineRegistry(join(storePath, "manifest.json"));
    await registry.conditionalRegister(config.machineId, hostname(), platform(), hasRealChanges);

    // 10. Commit and push with branch support
    await gitAdapter.commitAndPush(`sync: push from ${config.machineId}`, config.machineId);

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
