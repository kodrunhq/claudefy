import { join } from "node:path";
import { ConfigManager } from "../config/config-manager.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { PushCommand } from "./push.js";
import { HookManager } from "../hook-manager/hook-manager.js";

export interface InitOptions {
  backend: string;
  quiet: boolean;
  skipEncryption?: boolean;
  passphrase?: string;
  installHooks?: boolean;
}

export class InitCommand {
  private homeDir: string;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
  }

  async execute(options: InitOptions): Promise<void> {
    const configManager = new ConfigManager(this.homeDir);

    if (configManager.isInitialized()) {
      throw new Error("claudefy is already initialized. Use 'claudefy push' to sync.");
    }

    // 1. Initialize config
    const config = await configManager.initialize(options.backend);

    if (!options.quiet) {
      console.log(`Initialized claudefy with machine ID: ${config.machineId}`);
    }

    // 2. Initialize git store
    const gitAdapter = new GitAdapter(join(this.homeDir, ".claudefy"));
    await gitAdapter.initStore(options.backend);

    // 3. Run initial push
    const pushCommand = new PushCommand(this.homeDir);
    await pushCommand.execute({
      quiet: options.quiet,
      skipEncryption: options.skipEncryption,
      passphrase: options.passphrase,
    });

    // 4. Install hooks if requested
    if (options.installHooks) {
      const hookManager = new HookManager(join(this.homeDir, ".claude", "settings.json"));
      await hookManager.install();
      if (!options.quiet) {
        console.log("Auto-sync hooks installed.");
      }
    }

    if (!options.quiet) {
      console.log("Setup complete. Your Claude config is now synced.");
    }
  }
}
