import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { ConfigManager } from "../config/config-manager.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { PullCommand } from "./pull.js";
import { HookManager } from "../hook-manager/hook-manager.js";
import { MachineRegistry } from "../machine-registry/machine-registry.js";
import { hostname, platform } from "node:os";
import { output } from "../output.js";
import { promptExistingPassphrase } from "../encryptor/passphrase.js";

export interface JoinOptions {
  backend: string;
  quiet: boolean;
  skipEncryption?: boolean;
  passphrase?: string;
  installHooks?: boolean;
}

export class JoinCommand {
  private homeDir: string;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
  }

  async execute(options: JoinOptions): Promise<void> {
    const configManager = new ConfigManager(this.homeDir);

    if (configManager.isInitialized()) {
      throw new Error("claudefy is already initialized. Use 'claudefy pull' to sync.");
    }

    // 1. Initialize config
    const config = await configManager.initialize(options.backend);

    if (!options.quiet) {
      output.info(`Joined sync with machine ID: ${config.machineId}`);
    }

    // 2. Initialize git store and pull
    const gitAdapter = new GitAdapter(join(this.homeDir, ".claudefy"));
    await gitAdapter.initStore(options.backend);
    await gitAdapter.ensureMachineBranch(config.machineId);

    // 3. Prompt for passphrase if the store has encrypted files and none was provided
    let passphrase = options.passphrase;
    let useKeychain = false;
    if (!passphrase && !options.skipEncryption) {
      const hasEncrypted = await this.storeHasAgeFiles(gitAdapter.getStorePath());
      if (hasEncrypted && process.stdin.isTTY) {
        const setup = await promptExistingPassphrase();
        if (setup) {
          passphrase = setup.passphrase;
          useKeychain = setup.storedInKeychain;
        }
      }
    }

    if (useKeychain) {
      await configManager.set("encryption.useKeychain", true);
    }

    // 4. Run pull to get remote config
    const pullCommand = new PullCommand(this.homeDir);
    await pullCommand.execute({
      quiet: options.quiet,
      skipEncryption: options.skipEncryption,
      passphrase,
    });

    // 5. Register this machine and commit
    const registry = new MachineRegistry(join(gitAdapter.getStorePath(), "manifest.json"));
    await registry.register(config.machineId, hostname(), platform());
    const commitResult = await gitAdapter.commitAndPush(
      `sync: ${config.machineId} joined`,
      config.machineId,
    );
    if (!commitResult.pushed && !options.quiet) {
      output.warn(
        "Machine registry update could not be pushed to the remote. Check your connection and try 'claudefy push'.",
      );
    }

    // 6. Install hooks if requested
    if (options.installHooks) {
      const hookManager = new HookManager(join(this.homeDir, ".claude", "settings.json"));
      await hookManager.install();
      if (!options.quiet) {
        output.info("Auto-sync hooks installed.");
      }
    }

    if (!options.quiet) {
      output.success("Join complete. Your Claude config has been synced from remote.");
    }
  }

  private async storeHasAgeFiles(storePath: string): Promise<boolean> {
    const configDir = join(storePath, "config");
    const unknownDir = join(storePath, "unknown");
    for (const dir of [configDir, unknownDir]) {
      if (existsSync(dir) && (await this.hasAgeFilesRecursive(dir))) {
        return true;
      }
    }
    return false;
  }

  private async hasAgeFilesRecursive(dirPath: string): Promise<boolean> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (await this.hasAgeFilesRecursive(join(dirPath, entry.name))) return true;
      } else if (entry.name.endsWith(".age")) {
        return true;
      }
    }
    return false;
  }
}
