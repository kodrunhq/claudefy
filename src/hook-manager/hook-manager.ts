import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface HookEntry {
  type: string;
  command: string;
}

interface HookEventConfig {
  hooks: HookEntry[];
  matcher?: string;
}

interface ClaudeSettings {
  hooks?: Record<string, HookEventConfig[]>;
  [key: string]: unknown;
}

export class HookManager {
  private settingsPath: string;

  constructor(settingsPath: string) {
    this.settingsPath = settingsPath;
  }

  async install(): Promise<void> {
    const settings = await this.loadSettings();

    if (
      typeof settings.hooks !== "object" ||
      settings.hooks === null ||
      Array.isArray(settings.hooks)
    ) {
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
          (h: HookEventConfig) => !this.isClaudefyHookEntry(h),
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

    const startHooks = Array.isArray(settings.hooks.SessionStart)
      ? settings.hooks.SessionStart
      : [];
    const endHooks = Array.isArray(settings.hooks.SessionEnd) ? settings.hooks.SessionEnd : [];

    return this.hasClaudefyHook(startHooks) && this.hasClaudefyHook(endHooks);
  }

  private hasClaudefyHook(hookArray: HookEventConfig[]): boolean {
    return hookArray.some((h) => this.isClaudefyHookEntry(h));
  }

  private isClaudefyHookEntry(hookEntry: HookEventConfig): boolean {
    if (!Array.isArray(hookEntry.hooks)) return false;
    return hookEntry.hooks.some((h: HookEntry) => {
      const command = typeof h.command === "string" ? h.command.trim() : "";
      return command.startsWith("claudefy pull") || command.startsWith("claudefy push");
    });
  }

  private async loadSettings(): Promise<ClaudeSettings> {
    try {
      const content = await readFile(this.settingsPath, "utf-8");
      if (content.trim() === "") return {};
      try {
        return JSON.parse(content);
      } catch (err) {
        if (err instanceof SyntaxError) {
          throw new Error(`Invalid JSON in settings file "${this.settingsPath}": ${err.message}`, {
            cause: err,
          });
        }
        throw err;
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      throw err;
    }
  }

  private async saveSettings(settings: ClaudeSettings): Promise<void> {
    await mkdir(dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, JSON.stringify(settings, null, 2));
  }
}
