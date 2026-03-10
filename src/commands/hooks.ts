import { join } from "node:path";
import { HookManager } from "../hook-manager/hook-manager.js";

export class HooksCommand {
  private homeDir: string;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
  }

  async install(): Promise<void> {
    const hookManager = new HookManager(join(this.homeDir, ".claude", "settings.json"));
    await hookManager.install();
  }

  async remove(): Promise<void> {
    const hookManager = new HookManager(join(this.homeDir, ".claude", "settings.json"));
    await hookManager.remove();
  }

  async isInstalled(): Promise<boolean> {
    const hookManager = new HookManager(join(this.homeDir, ".claude", "settings.json"));
    return hookManager.isInstalled();
  }
}
