import { join } from "node:path";
import { ConfigManager } from "../config/config-manager.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { MachineRegistry, MachineEntry } from "../machine-registry/machine-registry.js";

export class MachinesCommand {
  private homeDir: string;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
  }

  async execute(): Promise<MachineEntry[]> {
    const configManager = new ConfigManager(this.homeDir);
    const config = await configManager.load();

    const gitAdapter = new GitAdapter(join(this.homeDir, ".claudefy"));
    await gitAdapter.initStore(config.backend.url);
    try {
      await gitAdapter.pull();
    } catch {
      // Fresh store
    }

    const registry = new MachineRegistry(join(gitAdapter.getStorePath(), "manifest.json"));
    return registry.list();
  }
}
