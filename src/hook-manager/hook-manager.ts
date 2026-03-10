import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class HookManager {
  private settingsPath: string;

  constructor(settingsPath: string) {
    this.settingsPath = settingsPath;
  }

  async install(): Promise<void> {
    const settings = await this.loadSettings();

    if (typeof settings.hooks !== "object" || settings.hooks === null || Array.isArray(settings.hooks)) {
      settings.hooks = {};
    }

    // SessionStart -> pull
    if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = [];
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
    if (!Array.isArray(settings.hooks.SessionEnd)) settings.hooks.SessionEnd = [];
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
        if (!Array.isArray(settings.hooks[event])) continue;
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

    const startHooks = Array.isArray(settings.hooks.SessionStart) ? settings.hooks.SessionStart : [];
    const endHooks = Array.isArray(settings.hooks.SessionEnd) ? settings.hooks.SessionEnd : [];

    return (
      this.hasClaudefyHook(startHooks) && this.hasClaudefyHook(endHooks)
    );
  }

  private hasClaudefyHook(hookArray: any[]): boolean {
    return hookArray.some((h) => this.isClaudefyHookEntry(h));
  }

  private isClaudefyHookEntry(hookEntry: any): boolean {
    return hookEntry.hooks?.some((h: any) => {
      const command = typeof h.command === "string" ? h.command.trim() : "";
      return command.startsWith("claudefy pull") || command.startsWith("claudefy push");
    });
  }

  private async loadSettings(): Promise<any> {
    try {
      const content = await readFile(this.settingsPath, "utf-8");
      if (content.trim() === "") return {};
      try {
        return JSON.parse(content);
      } catch (err) {
        if (err instanceof SyntaxError) return {};
        throw err;
      }
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && (err as any).code === "ENOENT") {
        return {};
      }
      throw err;
    }
  }

  private async saveSettings(settings: any): Promise<void> {
    await mkdir(dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, JSON.stringify(settings, null, 2));
  }
}
