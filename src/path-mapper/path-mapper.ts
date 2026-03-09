import type { LinksConfig } from "../config/types.js";

const CLAUDE_DIR_SENTINEL = "@@CLAUDE_DIR@@";

export class PathMapper {
  private links: LinksConfig;
  private pathToAlias: Map<string, string>;
  private canonicalToAlias: Map<string, string>;

  constructor(links: LinksConfig) {
    this.links = links;
    this.pathToAlias = new Map();
    this.canonicalToAlias = new Map();

    for (const [alias, info] of Object.entries(links)) {
      this.pathToAlias.set(info.localPath, alias);
      this.canonicalToAlias.set(info.canonicalId, alias);
    }
  }

  normalizeDirName(dirName: string): string | null {
    const path = dirName.replace(/^-/, "/").replace(/-/g, "/");
    for (const [alias, info] of Object.entries(this.links)) {
      if (path === info.localPath) {
        return info.canonicalId;
      }
    }
    return null;
  }

  remapDirName(canonicalId: string): string | null {
    const alias = this.canonicalToAlias.get(canonicalId);
    if (!alias) return null;
    const localPath = this.links[alias].localPath;
    return localPath.replace(/\//g, "-").replace(/^-/, "-");
  }

  normalizeJsonlLine(line: string): string {
    const obj = JSON.parse(line);
    if (obj.project) {
      obj.project = this.normalizePathField(obj.project);
    }
    if (obj.cwd) {
      obj.cwd = this.normalizePathField(obj.cwd);
    }
    return JSON.stringify(obj);
  }

  remapJsonlLine(line: string): string {
    const obj = JSON.parse(line);
    if (obj.project) {
      obj.project = this.remapPathField(obj.project);
    }
    if (obj.cwd) {
      obj.cwd = this.remapPathField(obj.cwd);
    }
    return JSON.stringify(obj);
  }

  normalizeSettingsPaths(settings: any, claudeDir: string): any {
    const json = JSON.stringify(settings);
    const normalized = json.replaceAll(claudeDir, CLAUDE_DIR_SENTINEL);
    return JSON.parse(normalized);
  }

  remapSettingsPaths(settings: any, claudeDir: string): any {
    const json = JSON.stringify(settings);
    const remapped = json.replaceAll(CLAUDE_DIR_SENTINEL, claudeDir);
    return JSON.parse(remapped);
  }

  normalizePluginPaths(plugins: any, claudeDir: string): any {
    const json = JSON.stringify(plugins);
    const normalized = json.replaceAll(claudeDir, CLAUDE_DIR_SENTINEL);
    return JSON.parse(normalized);
  }

  remapPluginPaths(plugins: any, claudeDir: string): any {
    const json = JSON.stringify(plugins);
    const remapped = json.replaceAll(CLAUDE_DIR_SENTINEL, claudeDir);
    return JSON.parse(remapped);
  }

  private normalizePathField(value: string): string {
    for (const [alias, info] of Object.entries(this.links)) {
      if (value === info.localPath || value.startsWith(info.localPath + "/")) {
        return `@@${alias}@@${value.slice(info.localPath.length)}`;
      }
    }
    return value;
  }

  private remapPathField(value: string): string {
    const match = value.match(/^@@([^@]+)@@(.*)$/);
    if (!match) return value;
    const alias = match[1];
    const suffix = match[2];
    const info = this.links[alias];
    if (!info) return value;
    return info.localPath + suffix;
  }
}
