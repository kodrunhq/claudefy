import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { hostname, platform } from "node:os";
import chalk from "chalk";
import { ConfigManager } from "../config/config-manager.js";
import { SyncFilter } from "../sync-filter/sync-filter.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { PathMapper } from "../path-mapper/path-mapper.js";
import { MachineRegistry } from "../machine-registry/machine-registry.js";
import { Encryptor } from "../encryptor/encryptor.js";
import { SecretScanner } from "../secret-scanner/scanner.js";
import { ClaudeJsonSync } from "../claude-json-sync/claude-json-sync.js";
import { output } from "../output.js";
import { STORE_CONFIG_DIR, STORE_UNKNOWN_DIR, STORE_MANIFEST_FILE } from "../config/defaults.js";
import { Lockfile } from "../lockfile/lockfile.js";
import { Logger } from "../logger.js";

export interface PushOptions {
  quiet: boolean;
  skipEncryption?: boolean;
  skipSecretScan?: boolean;
  passphrase?: string;
  only?: string;
  dryRun?: boolean;
  force?: boolean;
  logger?: Logger;
}

// Subdirectories within allowlisted items that should not be synced.
// These contain downloaded third-party content that can be re-fetched.
const SYNC_SKIP_DIRS = new Set(["plugins/cache", "plugins/marketplaces"]);

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
    const claudefyDir = join(this.homeDir, ".claudefy");
    const log = options.logger;

    await log?.log("info", "push", "Push started");

    const lock = Lockfile.tryAcquire("push", !!options.quiet, claudefyDir);
    if (!lock) {
      const msg = "Another claudefy process is running. Push skipped.";
      await log?.log("warn", "push", msg);
      if (!options.quiet) {
        output.warn(msg);
      }
      return;
    }

    try {
      await this.executeLocked(options, claudefyDir, log);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await log?.log("error", "push", msg);
      throw err;
    } finally {
      lock.release();
    }
  }

  private async executeLocked(
    options: PushOptions,
    claudefyDir: string,
    log: Logger | undefined,
  ): Promise<void> {
    const config = await this.configManager.load();

    if (options.skipEncryption && config.encryption.enabled && !options.quiet) {
      output.warn(
        "Encryption is enabled in config but --skip-encryption flag is set.\n" +
          "  Files will be pushed/pulled WITHOUT encryption. Use only for testing.",
      );
    }

    const syncFilterConfig = await this.configManager.getSyncFilter();
    const syncFilter = new SyncFilter(syncFilterConfig);

    // 1. Classify ~/.claude contents
    if (!existsSync(this.claudeDir)) {
      throw new Error(`No ${this.claudeDir} directory found. Nothing to push.`);
    }
    let classification = await syncFilter.classify(this.claudeDir);

    if (options.only) {
      const filtered = {
        ...classification,
        allowlist: classification.allowlist.filter((i) => i.name === options.only),
        unknown: classification.unknown.filter((i) => i.name === options.only),
      };
      if (filtered.allowlist.length === 0 && filtered.unknown.length === 0) {
        if (!options.quiet) output.warn(`No item matching "${options.only}" found.`);
        return;
      }
      classification = filtered;
    }

    const willEncrypt = config.encryption.enabled && !options.skipEncryption;
    await log?.log(
      "info",
      "push",
      `Classified: ${classification.allowlist.length} allowed, ${classification.unknown.length} unknown, ${classification.denylist.length} denied`,
    );
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
    if (!options.force) {
      try {
        await gitAdapter.pullAndMergeMain();
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : String(err);
        const msg = `Unable to pull latest changes from remote; proceeding with local state only. Detail: ${detail}`;
        await log?.log("warn", "push", msg);
        if (!options.quiet) {
          output.info(msg);
        }
      }
    }

    const storePath = gitAdapter.getStorePath();
    const configDir = join(storePath, STORE_CONFIG_DIR);
    const unknownDir = join(storePath, STORE_UNKNOWN_DIR);

    // Dry-run: show what would be pushed without modifying anything
    if (options.dryRun) {
      const { computeDiff } = await import("../diff-utils/diff-utils.js");
      const { cp, rm: rmTmp, mkdir: mkTmp } = await import("node:fs/promises");
      const tmpLocalConfig = join(this.homeDir, ".claudefy", ".dryrun-config-tmp");
      const tmpLocalUnknown = join(this.homeDir, ".claudefy", ".dryrun-unknown-tmp");
      if (existsSync(tmpLocalConfig)) await rmTmp(tmpLocalConfig, { recursive: true, force: true });
      if (existsSync(tmpLocalUnknown))
        await rmTmp(tmpLocalUnknown, { recursive: true, force: true });
      await mkTmp(tmpLocalConfig, { recursive: true });
      await mkTmp(tmpLocalUnknown, { recursive: true });
      try {
        for (const item of classification.allowlist) {
          const src = join(this.claudeDir, item.name);
          if (existsSync(src)) await cp(src, join(tmpLocalConfig, item.name), { recursive: true });
        }
        for (const item of classification.unknown) {
          const src = join(this.claudeDir, item.name);
          if (existsSync(src)) await cp(src, join(tmpLocalUnknown, item.name), { recursive: true });
        }
        const configDiff = await computeDiff(tmpLocalConfig, configDir);
        const unknownDiff = await computeDiff(tmpLocalUnknown, unknownDir);
        const hasChanges = configDiff.hasChanges || unknownDiff.hasChanges;
        if (!hasChanges) {
          if (!options.quiet) output.info("Dry run: no push changes detected.");
        } else {
          if (!options.quiet) {
            output.heading("Dry run — push would change:");
            const allAdded = [...configDiff.added, ...unknownDiff.added];
            const allModified = [...configDiff.modified, ...unknownDiff.modified];
            const allDeleted = [...configDiff.deleted, ...unknownDiff.deleted];
            for (const f of allAdded) console.log(chalk.green(`  Added:    ${f}`));
            for (const f of allModified) console.log(chalk.yellow(`  Modified: ${f}`));
            for (const f of allDeleted) console.log(chalk.red(`  Deleted:  ${f}`));
          }
          process.exitCode = 1;
        }
      } finally {
        if (existsSync(tmpLocalConfig))
          await rmTmp(tmpLocalConfig, { recursive: true, force: true });
        if (existsSync(tmpLocalUnknown))
          await rmTmp(tmpLocalUnknown, { recursive: true, force: true });
      }
      return;
    }

    // 3. Build path mapper
    const links = await this.configManager.getLinks();
    const pathMapper = new PathMapper(links);

    // 4. Hash existing store files
    const configHashes = await this.collectStoreHashes(configDir);
    const unknownHashes = await this.collectStoreHashes(unknownDir);

    // 5. Incremental sync — write only changed files
    const changedFiles: string[] = [];

    await mkdir(configDir, { recursive: true });
    await mkdir(unknownDir, { recursive: true });

    // Track which top-level items are being synced for deletion detection
    const syncedConfigItems: string[] = [];
    const syncedUnknownItems: string[] = [];

    for (const item of classification.allowlist) {
      syncedConfigItems.push(item.name);
      const src = join(this.claudeDir, item.name);
      await this.syncItem(src, configDir, item.name, configHashes, changedFiles, pathMapper);
    }

    for (const item of classification.unknown) {
      syncedUnknownItems.push(item.name);
      const src = join(this.claudeDir, item.name);
      await this.syncItem(src, unknownDir, item.name, unknownHashes, changedFiles, null);
    }

    // 6b. Extract syncable fields from ~/.claude.json (before deletion detection)
    if (config.claudeJson?.sync !== false) {
      const claudeJsonPath = join(this.homeDir, ".claude.json");
      const claudeJsonStorePath = join(configDir, "claude-json-sync.json");
      if (existsSync(claudeJsonPath)) {
        const claudeJsonSync = new ClaudeJsonSync();
        const extracted = claudeJsonSync.extract({
          claudeJsonPath,
          storePath: claudeJsonStorePath,
          homeDir: this.homeDir,
          syncMcpServers: config.claudeJson?.syncMcpServers ?? false,
        });
        if (Object.keys(extracted).length > 0) {
          const newContent = JSON.stringify(extracted, null, 2);
          // Only write if content changed — avoids unnecessary scanning/encryption
          const existingContent = existsSync(claudeJsonStorePath)
            ? await readFile(claudeJsonStorePath, "utf-8").catch(() => "")
            : "";
          if (newContent !== existingContent) {
            await writeFile(claudeJsonStorePath, newContent);
            changedFiles.push(claudeJsonStorePath);
          }
        }
      }
      // Protect from deletion detection — not a ~/.claude item but lives in configDir
      syncedConfigItems.push("claude-json-sync.json");
    }

    // 6c. Detect deletions — remove store entries not present in source
    await this.removeDeleted(configDir, syncedConfigItems);
    await this.removeDeleted(unknownDir, syncedUnknownItems);

    // 7. Scan for secrets and encrypt files that contain them
    const filesToEncrypt = new Set<string>();

    if (!options.skipSecretScan && changedFiles.length > 0) {
      const scanner = new SecretScanner(config.secretScanner?.customPatterns);
      const findings = await scanner.scanFiles(changedFiles);

      if (findings.length > 0) {
        if (!config.encryption.enabled || options.skipEncryption) {
          const details = findings.map((f) => `  ${f.file}:${f.line} [${f.pattern}]`).join("\n");
          throw new Error(
            `Secret scan detected ${findings.length} potential secret(s):\n${details}\n\nEnable encryption or use --skip-secret-scan to bypass scanning.`,
          );
        }

        for (const f of findings) {
          filesToEncrypt.add(f.file);
        }
      }
    }

    // 7b. Encrypt files based on encryption mode
    if (config.encryption.enabled && !options.skipEncryption) {
      const mode = config.encryption.mode ?? "reactive";
      if (mode === "full") {
        // Full mode: encrypt ALL files
        await this.collectFilesRecursive(configDir, filesToEncrypt);
        await this.collectFilesRecursive(unknownDir, filesToEncrypt);
      } else {
        // Reactive mode: only encrypt unknown-tier files
        await this.collectFilesRecursive(unknownDir, filesToEncrypt);
      }
    }

    // 7c. Perform encryption on all files that need it
    if (filesToEncrypt.size > 0) {
      if (!options.passphrase) {
        throw new Error(
          "Encryption is required but no passphrase found. Set CLAUDEFY_PASSPHRASE or ensure your passphrase is stored in your OS keychain (configured during 'claudefy init' or 'claudefy join').",
        );
      }

      const encryptor = new Encryptor(options.passphrase, config.backend.url);
      for (const filePath of filesToEncrypt) {
        if (existsSync(filePath) && !filePath.endsWith(".age")) {
          const ad = (
            filePath.startsWith(configDir)
              ? relative(configDir, filePath)
              : relative(unknownDir, filePath)
          )
            .split(sep)
            .join("/");
          await encryptor.encryptFile(filePath, filePath + ".age", ad);
          await rm(filePath);
        }
      }

      if (!options.quiet) {
        output.info(`Encrypted ${filesToEncrypt.size} file(s).`);
      }
    }

    // 8. Conditional manifest update
    const hasRealChanges = !(await gitAdapter.isClean());
    const registry = new MachineRegistry(join(storePath, STORE_MANIFEST_FILE));
    await registry.conditionalRegister(config.machineId, hostname(), platform(), hasRealChanges);

    // 9. Commit and push with branch support
    const commitResult = await gitAdapter.commitAndPush(
      `sync: push from ${config.machineId}`,
      config.machineId,
    );

    await log?.log("info", "push", `Encrypted ${filesToEncrypt.size} file(s)`);

    if (commitResult.committed && !commitResult.pushed) {
      await log?.log("warn", "push", "Changes committed locally but push to remote failed");
      if (!options.quiet) {
        output.warn(
          "Changes were committed locally, but pushing to the remote failed. Retry with 'claudefy push'.",
        );
      }
    }
    if (commitResult.pushed && !commitResult.mergedToMain) {
      await log?.log(
        "warn",
        "push",
        "Pushed but merge to main failed — may need conflict resolution",
      );
      if (!options.quiet) {
        output.warn("Unable to merge machine branch into main. You may need to resolve conflicts.");
      }
    }

    await log?.log(
      "info",
      "push",
      `Push complete. committed=${commitResult.committed} pushed=${commitResult.pushed}`,
    );
    if (!options.quiet) {
      output.success("Push complete.");
    }
  }

  private async hashFile(filePath: string): Promise<string> {
    const content = await readFile(filePath);
    return createHash("sha256").update(content).digest("hex");
  }

  private async hashContent(content: string | Buffer): Promise<string> {
    return createHash("sha256").update(content).digest("hex");
  }

  private async collectStoreHashes(
    dirPath: string,
    prefix: string = "",
  ): Promise<Map<string, string>> {
    const hashes = new Map<string, string>();
    if (!existsSync(dirPath)) return hashes;
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const sub = await this.collectStoreHashes(fullPath, relPath);
        for (const [k, v] of sub) hashes.set(k, v);
      } else if (!entry.isSymbolicLink()) {
        hashes.set(relPath, await this.hashFile(fullPath));
      }
    }
    return hashes;
  }

  private needsNormalization(itemName: string): boolean {
    return (
      ["settings.json", "history.jsonl"].includes(itemName) ||
      itemName === "plugins/installed_plugins.json" ||
      itemName === "plugins/known_marketplaces.json"
    );
  }

  private normalizeContent(itemName: string, text: string, pathMapper: PathMapper): string {
    if (itemName === "settings.json") {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(`Failed to parse ${itemName}: ${(err as Error).message}`, { cause: err });
      }
      const normalized = pathMapper.normalizeSettingsPaths(parsed, this.claudeDir);
      return JSON.stringify(normalized, null, 2);
    }
    if (
      itemName === "plugins/installed_plugins.json" ||
      itemName === "plugins/known_marketplaces.json"
    ) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(`Failed to parse ${itemName}: ${(err as Error).message}`, { cause: err });
      }
      const normalized = pathMapper.normalizePluginPaths(parsed, this.claudeDir);
      return JSON.stringify(normalized, null, 2);
    }
    if (itemName === "history.jsonl") {
      return (
        text
          .split("\n")
          .filter(Boolean)
          .map((line) => pathMapper.normalizeJsonlLine(line))
          .join("\n") + "\n"
      );
    }
    return text;
  }

  private async syncItem(
    srcPath: string,
    destBaseDir: string,
    itemName: string,
    storeHashes: Map<string, string>,
    changedFiles: string[],
    pathMapper: PathMapper | null,
  ): Promise<void> {
    const srcStat = await lstat(srcPath);
    if (srcStat.isSymbolicLink()) return;

    if (srcStat.isFile()) {
      let content: Buffer;
      if (pathMapper && this.needsNormalization(itemName)) {
        const text = await readFile(srcPath, "utf-8");
        content = Buffer.from(this.normalizeContent(itemName, text, pathMapper));
      } else {
        content = await readFile(srcPath);
      }
      const hash = await this.hashContent(content);
      const storeHash = storeHashes.get(itemName);
      if (hash !== storeHash) {
        const destPath = join(destBaseDir, itemName);
        const parentDir = join(destPath, "..");
        await mkdir(parentDir, { recursive: true });
        await writeFile(destPath, content);
        changedFiles.push(destPath);
      }
    } else if (srcStat.isDirectory()) {
      await this.syncDirectory(
        srcPath,
        destBaseDir,
        itemName,
        storeHashes,
        changedFiles,
        pathMapper,
      );
    }
  }

  private async syncDirectory(
    srcDir: string,
    destBaseDir: string,
    itemName: string,
    storeHashes: Map<string, string>,
    changedFiles: string[],
    pathMapper: PathMapper | null,
  ): Promise<void> {
    // Skip non-syncable subdirectories (downloaded caches, re-fetchable content)
    if (SYNC_SKIP_DIRS.has(itemName)) return;

    const destDir = join(destBaseDir, itemName);
    await mkdir(destDir, { recursive: true });
    const entries = await readdir(srcDir, { withFileTypes: true });

    // Track children for deletion detection within this directory
    const childNames: string[] = [];

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      // Never sync .git directories (submodules inside plugin caches, etc.)
      if (entry.name === ".git") continue;
      const srcPath = join(srcDir, entry.name);

      if (entry.isDirectory()) {
        // Handle projects/ directory renaming
        if (itemName === "projects" && pathMapper) {
          const canonicalName = pathMapper.normalizeDirName(entry.name);
          if (canonicalName) {
            // Path traversal check
            const destPath = resolve(join(destDir, canonicalName));
            const rel = relative(resolve(destDir), destPath);
            if (rel.startsWith("..") || resolve(destPath) === resolve(destDir)) {
              continue;
            }
            const canonicalChildName = `${itemName}/${canonicalName}`;
            childNames.push(canonicalName);
            await this.syncDirectory(
              srcPath,
              destBaseDir,
              canonicalChildName,
              storeHashes,
              changedFiles,
              pathMapper,
            );
            continue;
          }
        }
        childNames.push(entry.name);
        const childName = `${itemName}/${entry.name}`;
        await this.syncDirectory(
          srcPath,
          destBaseDir,
          childName,
          storeHashes,
          changedFiles,
          pathMapper,
        );
      } else {
        childNames.push(entry.name);
        const childName = `${itemName}/${entry.name}`;
        let content: Buffer;
        if (pathMapper && this.needsNormalization(childName)) {
          const text = await readFile(srcPath, "utf-8");
          content = Buffer.from(this.normalizeContent(childName, text, pathMapper));
        } else {
          content = await readFile(srcPath);
        }
        const hash = await this.hashContent(content);
        const storeHash = storeHashes.get(childName);
        if (hash !== storeHash) {
          const destPath = join(destBaseDir, childName);
          await mkdir(join(destPath, ".."), { recursive: true });
          await writeFile(destPath, content);
          changedFiles.push(destPath);
        }
      }
    }

    // Remove files/dirs in the store directory that no longer exist in source
    if (existsSync(destDir)) {
      const storeEntries = await readdir(destDir);
      const childSet = new Set(childNames);
      for (const storeEntry of storeEntries) {
        const baseName = storeEntry.endsWith(".age") ? storeEntry.slice(0, -4) : storeEntry;
        if (!childSet.has(baseName) && !childSet.has(storeEntry)) {
          await rm(join(destDir, storeEntry), { recursive: true });
        }
      }
    }
  }

  private async collectFilesRecursive(dirPath: string, files: Set<string>): Promise<void> {
    if (!existsSync(dirPath)) return;
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.collectFilesRecursive(fullPath, files);
      } else if (!entry.isSymbolicLink() && !entry.name.endsWith(".age")) {
        files.add(fullPath);
      }
    }
  }

  private async removeDeleted(storeDir: string, currentItems: string[]): Promise<void> {
    if (!existsSync(storeDir)) return;
    const entries = await readdir(storeDir);
    const currentSet = new Set(currentItems);
    for (const entry of entries) {
      const baseName = entry.endsWith(".age") ? entry.slice(0, -4) : entry;
      if (!currentSet.has(baseName) && !currentSet.has(entry)) {
        await rm(join(storeDir, entry), { recursive: true });
      }
    }
  }
}
