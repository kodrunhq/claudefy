import { join } from "node:path";
import { ConfigManager } from "../config/config-manager.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { PushCommand } from "./push.js";
import { output } from "../output.js";
import { withLock } from "../lockfile/lockfile.js";

export interface OverrideOptions {
  quiet: boolean;
  skipEncryption?: boolean;
  passphrase?: string;
  confirm?: boolean;
}

export class OverrideCommand {
  private homeDir: string;
  private configManager: ConfigManager;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
    this.configManager = new ConfigManager(homeDir);
  }

  async execute(options: OverrideOptions): Promise<void> {
    const claudefyDir = join(this.homeDir, ".claudefy");
    await withLock("override", !!options.quiet, claudefyDir, async () => {
      if (!options.confirm) {
        throw new Error(
          "Override requires --confirm flag. This will wipe the remote store and replace it with your local config.",
        );
      }

      const config = await this.configManager.load();

      if (!options.quiet) {
        output.warn(`Overriding remote store as machine: ${config.machineId}`);
      }

      // 1. Initialize git adapter
      const gitAdapter = new GitAdapter(join(this.homeDir, ".claudefy"));
      await gitAdapter.initStore(config.backend.url);
      await gitAdapter.ensureMachineBranch(config.machineId);
      try {
        await gitAdapter.pullAndMergeMain();
      } catch {
        // Fresh store with no remote history yet
      }

      // 2. Wipe remote and write override marker
      await gitAdapter.wipeAndPush(config.machineId);

      // 3. Run full push pipeline to repopulate store
      // Skip secret scanning: override re-pushes ALL files (store was wiped so every
      // file looks "changed"). Rescanning triggers false positives on conversation
      // transcripts that already passed scanning on their original push.
      const pushCommand = new PushCommand(this.homeDir);
      await pushCommand.execute({
        quiet: options.quiet,
        skipEncryption: options.skipEncryption,
        skipSecretScan: true,
        passphrase: options.passphrase,
      });

      if (!options.quiet) {
        output.success(
          "Override complete. All other machines will receive your config on next pull.",
        );
      }
    });
  }
}
