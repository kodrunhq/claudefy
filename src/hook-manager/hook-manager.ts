import { readFile, writeFile } from "node:fs/promises";

const CLAUDEFY_MARKER = "claudefy";

export class HookManager {
  private settingsPath: string;

  constructor(settingsPath: string) {
    this.settingsPath = settingsPath;
  }

  async install(): Promise<void> {
    const settings = await this.loadSettings();

    if (!settings.hooks) settings.hooks = {};

    // SessionStart -> pull
    if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
    if (!this.hasClaudefyHook(settings.hooks.SessionStart)) {
      settings.hooks.SessionStart.push({
        hooks: [
          {
            type: "command",
            command: "claudefy pull --quiet",
          },
        ],
      });
    }

    // SessionEnd -> push
    if (!settings.hooks.SessionEnd) settings.hooks.SessionEnd = [];
    if (!this.hasClaudefyHook(settings.hooks.SessionEnd)) {
      settings.hooks.SessionEnd.push({
        hooks: [
          {
            type: "command",
            command: "claudefy push --quiet",
          },
        ],
      });
    }

    await this.saveSettings(settings);
  }

  async remove(): Promise<void> {
    const settings = await this.loadSettings();

    if (settings.hooks) {
      for (const event of Object.keys(settings.hooks)) {
        settings.hooks[event] = settings.hooks[event].filter(
          (h: any) => !this.isClaudefyHookEntry(h)
        );
        if (settings.hooks[event].length === 0) {
          delete settings.hooks[event];
        }
      }
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }
    }

    await this.saveSettings(settings);
  }

  async isInstalled(): Promise<boolean> {
    const settings = await this.loadSettings();
    if (!settings.hooks) return false;

    const startHooks = settings.hooks.SessionStart || [];
    const endHooks = settings.hooks.SessionEnd || [];

    return (
      this.hasClaudefyHook(startHooks) && this.hasClaudefyHook(endHooks)
    );
  }

  private hasClaudefyHook(hookArray: any[]): boolean {
    return hookArray.some((h) => this.isClaudefyHookEntry(h));
  }

  private isClaudefyHookEntry(hookEntry: any): boolean {
    return hookEntry.hooks?.some((h: any) =>
      h.command?.includes(CLAUDEFY_MARKER)
    );
  }

  private async loadSettings(): Promise<any> {
    const content = await readFile(this.settingsPath, "utf-8");
    return JSON.parse(content);
  }

  private async saveSettings(settings: any): Promise<void> {
    await writeFile(this.settingsPath, JSON.stringify(settings, null, 2));
  }
}
