import { join } from "node:path";
import { lstat, readdir, writeFile } from "node:fs/promises";
import { ConfigManager } from "../config/config-manager.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { PullCommand } from "./pull.js";
import { HookManager } from "../hook-manager/hook-manager.js";
import { MachineRegistry } from "../machine-registry/machine-registry.js";
import { hostname, platform } from "node:os";
import { output } from "../output.js";
import { promptExistingPassphrase } from "../encryptor/passphrase.js";
import { withLock } from "../lockfile/lockfile.js";
import {
  CLAUDEFY_DIR,
  STORE_CONFIG_DIR,
  STORE_UNKNOWN_DIR,
  STORE_MANIFEST_FILE,
  MACHINE_ID_FILE,
} from "../config/defaults.js";

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
    const claudefyDir = join(this.homeDir, CLAUDEFY_DIR);
    await withLock(
      "join",
      !!options.quiet,
      claudefyDir,
      async () => {
        const configManager = new ConfigManager(this.homeDir);

        if (configManager.isInitialized()) {
          throw new Error("claudefy is already initialized. Use 'claudefy pull' to sync.");
        }

        // 1. Initialize config (generates a fresh machineId)
        const config = await configManager.initialize(options.backend);

        // 2. Initialize git store and check for existing machine with same hostname
        const gitAdapter = new GitAdapter(join(this.homeDir, CLAUDEFY_DIR));
        await gitAdapter.initStore(options.backend);

        // Reuse machine ID if this hostname was previously registered (e.g. after
        // deleting ~/.claudefy and rejoining). This keeps the same per-machine
        // branch and avoids orphaned entries in the manifest.
        const remoteRegistry = new MachineRegistry(
          join(gitAdapter.getStorePath(), STORE_MANIFEST_FILE),
        );
        const existingMachines = await remoteRegistry.list();
        const localHostname = hostname().toLowerCase();
        const previousMachine = existingMachines.find(
          (m) => m.hostname.toLowerCase() === localHostname,
        );
        if (previousMachine) {
          config.machineId = previousMachine.machineId;
          await configManager.set("machineId", config.machineId);
          await writeFile(join(claudefyDir, MACHINE_ID_FILE), config.machineId);
        }

        if (!options.quiet) {
          output.info(`Joined sync with machine ID: ${config.machineId}`);
        }

        await gitAdapter.ensureMachineBranch(config.machineId);
        await gitAdapter.ensureGitattributes();

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

        // 4b. Detect encryption state from store
        if (!options.skipEncryption && !passphrase) {
          // No passphrase was needed/provided — store is not encrypted
          await configManager.set("encryption.enabled", false);
        }

        // 5. Register this machine and commit
        const registry = new MachineRegistry(join(gitAdapter.getStorePath(), STORE_MANIFEST_FILE));
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

        if (!options.installHooks && !options.quiet) {
          output.dim("Tip: run 'claudefy hooks install' to enable auto-sync on this machine");
        }
      },
      { critical: true },
    );
  }

  private async storeHasAgeFiles(storePath: string): Promise<boolean> {
    const configDir = join(storePath, STORE_CONFIG_DIR);
    const unknownDir = join(storePath, STORE_UNKNOWN_DIR);
    for (const dir of [configDir, unknownDir]) {
      try {
        const stats = await lstat(dir);
        if (!stats.isDirectory() || stats.isSymbolicLink()) continue;
        if (await this.hasAgeFilesRecursive(dir)) return true;
      } catch {
        // Directory doesn't exist, skip
      }
    }
    return false;
  }

  private async hasAgeFilesRecursive(dirPath: string): Promise<boolean> {
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (await this.hasAgeFilesRecursive(join(dirPath, entry.name))) return true;
      } else if (entry.name.endsWith(".age")) {
        return true;
      }
    }
    return false;
  }
}
