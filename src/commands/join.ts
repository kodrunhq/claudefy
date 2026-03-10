import { join } from "node:path";
import { ConfigManager } from "../config/config-manager.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { PullCommand } from "./pull.js";
import { HookManager } from "../hook-manager/hook-manager.js";
import { MachineRegistry } from "../machine-registry/machine-registry.js";
import { hostname, platform } from "node:os";

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
      console.log(`Joined sync with machine ID: ${config.machineId}`);
    }

    // 2. Initialize git store and pull
    const gitAdapter = new GitAdapter(join(this.homeDir, ".claudefy"));
    await gitAdapter.initStore(options.backend);

    // 3. Register this machine
    const registry = new MachineRegistry(join(gitAdapter.getStorePath(), "manifest.json"));
    await registry.register(config.machineId, hostname(), platform());

    // 4. Run pull to get remote config
    const pullCommand = new PullCommand(this.homeDir);
    await pullCommand.execute({
      quiet: options.quiet,
      skipEncryption: options.skipEncryption,
      passphrase: options.passphrase,
    });

    // 5. Install hooks if requested
    if (options.installHooks) {
      const hookManager = new HookManager(join(this.homeDir, ".claude", "settings.json"));
      await hookManager.install();
      if (!options.quiet) {
        console.log("Auto-sync hooks installed.");
      }
    }

    if (!options.quiet) {
      console.log("Join complete. Your Claude config has been synced from remote.");
    }
  }
}
