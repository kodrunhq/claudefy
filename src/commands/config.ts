import { ConfigManager } from "../config/config-manager.js";
import { output } from "../output.js";

export class ConfigCommand {
  private homeDir: string;

  private static readonly CONFIG_SCHEMA: Record<string, { type: string; values?: unknown[] }> = {
    "encryption.enabled": { type: "boolean" },
    "encryption.useKeychain": { type: "boolean" },
    "encryption.cacheDuration": { type: "string" },
    "encryption.mode": { type: "string", values: ["reactive", "full"] },
    "backend.type": { type: "string", values: ["git"] },
    "backend.url": { type: "string" },
    "claudeJson.sync": { type: "boolean" },
    "claudeJson.syncMcpServers": { type: "boolean" },
    "secretScanner.customPatterns": { type: "object" },
    "backups.maxCount": { type: "number" },
    "backups.maxAgeDays": { type: "number" },
    version: { type: "number" },
  };

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

    const schema = ConfigCommand.CONFIG_SCHEMA[key];
    const parsed = this.parseValue(value, schema?.type);

    if (schema) {
      const actualType = typeof parsed;
      if (actualType !== schema.type && !(schema.type === "object" && Array.isArray(parsed))) {
        throw new Error(`"${key}" expects ${schema.type}, got ${actualType}`);
      }
      if (schema.values && !schema.values.includes(parsed)) {
        throw new Error(`"${key}" must be one of: ${schema.values.join(", ")}`);
      }
    } else {
      output.warn(`Unknown config key "${key}". Setting anyway.`);
    }

    await configManager.set(key, parsed);
  }

  private parseValue(value: unknown, schemaType?: string): unknown {
    if (typeof value !== "string") return value;

    // If schema says string, don't coerce
    if (schemaType === "string") return value;

    // If schema says object, try JSON parsing
    if (schemaType === "object") {
      try {
        return JSON.parse(value);
      } catch {
        throw new Error(`Expected JSON for object value, got: ${value}`);
      }
    }

    if (value === "true") return true;
    if (value === "false") return false;
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== "") return num;
    return value;
  }
}
