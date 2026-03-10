import { join } from "node:path";
import { HookManager } from "../hook-manager/hook-manager.js";

export class HooksCommand {
  private hookManager: HookManager;

  constructor(homeDir: string) {
    this.hookManager = new HookManager(join(homeDir, ".claude", "settings.json"));
  }

  async install(): Promise<void> {
    await this.hookManager.install();
  }

  async remove(): Promise<void> {
    await this.hookManager.remove();
  }

  async isInstalled(): Promise<boolean> {
    return this.hookManager.isInstalled();
  }
}
