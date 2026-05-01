import { join } from "node:path";
import { ConfigManager } from "../config/config-manager.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { MachineRegistry, MachineEntry } from "../machine-registry/machine-registry.js";
import { CLAUDEFY_DIR, STORE_MANIFEST_FILE } from "../config/defaults.js";

export class MachinesCommand {
  private homeDir: string;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
  }

  async execute(): Promise<MachineEntry[]> {
    const configManager = new ConfigManager(this.homeDir);
    const config = await configManager.load();

    const gitAdapter = new GitAdapter(join(this.homeDir, CLAUDEFY_DIR));
    await gitAdapter.initStore(config.backend.url);
    await gitAdapter.ensureMachineBranch(config.machineId);
    try {
      await gitAdapter.pullAndMergeMain();
    } catch {
      // Fresh store
    }

    const registry = new MachineRegistry(join(gitAdapter.getStorePath(), STORE_MANIFEST_FILE));
    return registry.list();
  }
}
