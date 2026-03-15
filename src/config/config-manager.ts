import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { ClaudefyConfig, LinksConfig, SyncFilterConfig } from "./types.js";
import {
  CLAUDEFY_DIR,
  CONFIG_FILE,
  LINKS_FILE,
  SYNC_FILTER_FILE,
  MACHINE_ID_FILE,
  DEFAULT_SYNC_FILTER,
} from "./defaults.js";

export class ConfigManager {
  private baseDir: string;
  private configDir: string;

  constructor(homeDir: string) {
    this.baseDir = homeDir;
    this.configDir = join(homeDir, CLAUDEFY_DIR);
  }

  async initialize(
    backendUrl: string,
    options?: { useKeychain?: boolean },
  ): Promise<ClaudefyConfig> {
    if (this.isInitialized()) {
      throw new Error("claudefy is already initialized. Use 'load()' to read existing config.");
    }

    await mkdir(this.configDir, { recursive: true });
    await mkdir(join(this.configDir, "backups"), { recursive: true });

    const machineId = `${hostname()}-${randomUUID().slice(0, 8)}`.toLowerCase();
    await writeFile(join(this.configDir, MACHINE_ID_FILE), machineId);

    const config: ClaudefyConfig = {
      version: 1,
      backend: { type: "git", url: backendUrl },
      encryption: {
        enabled: true,
        useKeychain: options?.useKeychain ?? false,
        cacheDuration: "0",
        mode: "reactive" as const,
      },
      machineId,
    };

    await this.saveConfig(config);
    await this.saveLinks({});
    await this.saveSyncFilter({ ...DEFAULT_SYNC_FILTER });

    return config;
  }

  async load(): Promise<ClaudefyConfig> {
    const path = join(this.configDir, CONFIG_FILE);
    const raw = await readFile(path, "utf-8");
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `Corrupt config file "${path}": ${(err as Error).message}. Delete and re-run 'claudefy init'.`,
        { cause: err },
      );
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    const FORBIDDEN_KEYS = ["__proto__", "prototype", "constructor"];
    const isUnsafeObject = (target: unknown): boolean => {
      if (target === null || target === undefined) return true;
      if (typeof target !== "object") return true;
      // Never allow writing through or onto Object.prototype
      return target === Object.prototype;
    };
    const parts = key.split(".");
    for (const part of parts) {
      if (FORBIDDEN_KEYS.includes(part)) {
        throw new Error(`Forbidden config key segment: "${part}"`);
      }
    }
    const config = await this.load();
    let obj: Record<string, unknown> = config as unknown as Record<string, unknown>;
    // Prevent traversing into polluted objects
    if (isUnsafeObject(obj)) {
      throw new Error("Configuration root object is invalid or unsafe");
    }
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i];
      if (FORBIDDEN_KEYS.includes(segment)) {
        throw new Error(`Forbidden config key segment: "${segment}"`);
      }
      const next = (obj as Record<string, unknown>)[segment];
      if (isUnsafeObject(next)) {
        throw new Error(`Invalid config key: "${key}" — "${segment}" is not a safe object`);
      }
      obj = next as Record<string, unknown>;
    }
    const lastSegment = parts[parts.length - 1];
    if (FORBIDDEN_KEYS.includes(lastSegment)) {
      throw new Error(`Forbidden config key segment: "${lastSegment}"`);
    }
    if (isUnsafeObject(obj)) {
      throw new Error("Cannot assign to unsafe configuration object");
    }
    (obj as Record<string, unknown>)[lastSegment] = value;
    await this.saveConfig(config);
  }

  async addLink(
    alias: string,
    localPath: string,
    meta: { canonicalId: string; gitRemote: string | null },
  ): Promise<void> {
    const links = await this.getLinks();
    links[alias] = {
      localPath,
      canonicalId: meta.canonicalId,
      gitRemote: meta.gitRemote,
      detectedAt: new Date().toISOString(),
    };
    await this.saveLinks(links);
  }

  async removeLink(alias: string): Promise<void> {
    const links = await this.getLinks();
    delete links[alias];
    await this.saveLinks(links);
  }

  async getLinks(): Promise<LinksConfig> {
    const path = join(this.configDir, LINKS_FILE);
    if (!existsSync(path)) return {};
    const raw = await readFile(path, "utf-8");
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`Corrupt links file "${path}": ${(err as Error).message}`, { cause: err });
    }
  }

  async getSyncFilter(): Promise<SyncFilterConfig> {
    const path = join(this.configDir, SYNC_FILTER_FILE);
    if (!existsSync(path)) return { ...DEFAULT_SYNC_FILTER };
    const raw = await readFile(path, "utf-8");
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`Corrupt sync filter file "${path}": ${(err as Error).message}`, {
        cause: err,
      });
    }
  }

  isInitialized(): boolean {
    return existsSync(join(this.configDir, CONFIG_FILE));
  }

  private async saveConfig(config: ClaudefyConfig): Promise<void> {
    await writeFile(join(this.configDir, CONFIG_FILE), JSON.stringify(config, null, 2));
  }

  private async saveLinks(links: LinksConfig): Promise<void> {
    await writeFile(join(this.configDir, LINKS_FILE), JSON.stringify(links, null, 2));
  }

  private async saveSyncFilter(filter: SyncFilterConfig): Promise<void> {
    await writeFile(join(this.configDir, SYNC_FILTER_FILE), JSON.stringify(filter, null, 2));
  }
}
