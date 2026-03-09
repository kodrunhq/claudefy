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

  async initialize(backendUrl: string): Promise<ClaudefyConfig> {
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
        useKeychain: false,
        cacheDuration: "0",
      },
      sync: {
        lfsThreshold: 512 * 1024, // 512KB
      },
      filter: {},
      machineId,
    };

    await this.saveConfig(config);
    await this.saveLinks({});
    await this.saveSyncFilter({ ...DEFAULT_SYNC_FILTER });

    return config;
  }

  async load(): Promise<ClaudefyConfig> {
    const raw = await readFile(join(this.configDir, CONFIG_FILE), "utf-8");
    return JSON.parse(raw);
  }

  async set(key: string, value: unknown): Promise<void> {
    const config = await this.load();
    const parts = key.split(".");
    let obj: Record<string, unknown> = config as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = obj[parts[i]];
      if (next === undefined || next === null || typeof next !== "object") {
        throw new Error(`Invalid config key: "${key}" — "${parts[i]}" is not an object`);
      }
      obj = next as Record<string, unknown>;
    }
    obj[parts[parts.length - 1]] = value;
    await this.saveConfig(config);
  }

  async addLink(
    alias: string,
    localPath: string,
    meta: { canonicalId: string; gitRemote: string | null }
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
    return JSON.parse(raw);
  }

  async getSyncFilter(): Promise<SyncFilterConfig> {
    const path = join(this.configDir, SYNC_FILTER_FILE);
    if (!existsSync(path)) return { ...DEFAULT_SYNC_FILTER };
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw);
  }

  async setFilterOverride(name: string, tier: "allow" | "deny"): Promise<void> {
    const filter = await this.getSyncFilter();
    filter.denylist = filter.denylist.filter((d) => d !== name);
    filter.allowlist = filter.allowlist.filter((a) => a !== name);
    if (tier === "allow") {
      filter.allowlist.push(name);
    } else {
      filter.denylist.push(name);
    }
    await this.saveSyncFilter(filter);
  }

  isInitialized(): boolean {
    return existsSync(join(this.configDir, CONFIG_FILE));
  }

  getConfigDir(): string {
    return this.configDir;
  }

  private async saveConfig(config: ClaudefyConfig): Promise<void> {
    await writeFile(
      join(this.configDir, CONFIG_FILE),
      JSON.stringify(config, null, 2)
    );
  }

  private async saveLinks(links: LinksConfig): Promise<void> {
    await writeFile(
      join(this.configDir, LINKS_FILE),
      JSON.stringify(links, null, 2)
    );
  }

  private async saveSyncFilter(filter: SyncFilterConfig): Promise<void> {
    await writeFile(
      join(this.configDir, SYNC_FILTER_FILE),
      JSON.stringify(filter, null, 2)
    );
  }
}
