import { ConfigManager } from "../config/config-manager.js";

export class ConfigCommand {
  private homeDir: string;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
  }

  async get(key?: string): Promise<unknown> {
    const configManager = new ConfigManager(this.homeDir);
    if (!configManager.isInitialized()) {
      throw new Error("claudefy is not initialized. Run 'claudefy init' first.");
    }

    const config = await configManager.load();

    if (!key) return config;

    const parts = key.split(".");
    let current: unknown = config;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== "object") {
        throw new Error(`Invalid config key: "${key}"`);
      }
      current = (current as Record<string, unknown>)[part];
      if (current === undefined) {
        throw new Error(`Invalid config key: "${key}"`);
      }
    }
    return current;
  }

  private static readonly FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

  async set(key: string, value: unknown): Promise<void> {
    const configManager = new ConfigManager(this.homeDir);
    if (!configManager.isInitialized()) {
      throw new Error("claudefy is not initialized. Run 'claudefy init' first.");
    }

    const parts = key.split(".");
    for (const part of parts) {
      if (ConfigCommand.FORBIDDEN_KEYS.has(part)) {
        throw new Error(`Invalid config key: "${key}" — "${part}" is not allowed`);
      }
    }

    const parsed = this.parseValue(value);
    await configManager.set(key, parsed);
  }

  private parseValue(value: unknown): unknown {
    if (typeof value !== "string") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== "") return num;
    return value;
  }
}
