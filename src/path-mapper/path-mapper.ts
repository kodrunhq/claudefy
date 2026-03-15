import type { LinksConfig } from "../config/types.js";

const CLAUDE_DIR_SENTINEL = "@@CLAUDE_DIR@@";

export class PathMapper {
  private links: LinksConfig;
  private canonicalToAlias: Map<string, string>;
  private dirNameToCanonical: Map<string, string>;

  constructor(links: LinksConfig) {
    this.links = links;
    this.canonicalToAlias = new Map();
    this.dirNameToCanonical = new Map();

    for (const [alias, info] of Object.entries(links)) {
      // Normalize trailing slash from localPath
      const normalizedPath = info.localPath.replace(/\/+$/, "");
      this.canonicalToAlias.set(info.canonicalId, alias);
      // Pre-compute the encoded dir name for each link
      const encoded = this.pathToDirName(normalizedPath);
      this.dirNameToCanonical.set(encoded, info.canonicalId);
    }
  }

  normalizeDirName(dirName: string): string | null {
    return this.dirNameToCanonical.get(dirName) ?? null;
  }

  remapDirName(canonicalId: string): string | null {
    const alias = this.canonicalToAlias.get(canonicalId);
    if (!alias) return null;
    return this.pathToDirName(this.links[alias].localPath);
  }

  normalizeJsonlLine(line: string): string {
    try {
      const obj = JSON.parse(line);
      if (obj.project) {
        obj.project = this.normalizePathField(obj.project);
      }
      if (obj.cwd) {
        obj.cwd = this.normalizePathField(obj.cwd);
      }
      return JSON.stringify(obj);
    } catch {
      return line;
    }
  }

  remapJsonlLine(line: string): string {
    try {
      const obj = JSON.parse(line);
      if (obj.project) {
        obj.project = this.remapPathField(obj.project);
      }
      if (obj.cwd) {
        obj.cwd = this.remapPathField(obj.cwd);
      }
      return JSON.stringify(obj);
    } catch {
      return line;
    }
  }

  normalizeSettingsPaths<T>(settings: T, claudeDir: string): T {
    return this.replaceInValues(settings, claudeDir, CLAUDE_DIR_SENTINEL);
  }

  remapSettingsPaths<T>(settings: T, claudeDir: string): T {
    return this.replaceInValues(settings, CLAUDE_DIR_SENTINEL, claudeDir);
  }

  normalizePluginPaths<T>(plugins: T, claudeDir: string): T {
    return this.replaceInValues(plugins, claudeDir, CLAUDE_DIR_SENTINEL);
  }

  remapPluginPaths<T>(plugins: T, claudeDir: string): T {
    return this.replaceInValues(plugins, CLAUDE_DIR_SENTINEL, claudeDir);
  }

  private replaceInValues<T>(value: T, search: string, replacement: string): T {
    if (typeof value === "string") {
      return value.replaceAll(search, replacement) as T;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.replaceInValues(item, search, replacement)) as T;
    }
    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = this.replaceInValues(v, search, replacement);
      }
      return result as T;
    }
    return value;
  }

  private pathToDirName(localPath: string): string {
    // Claude Code encodes paths by replacing / with -
    // e.g. /home/user/project -> -home-user-project
    return localPath.replace(/[\\/]/g, "-");
  }

  private normalizePathField(value: string): string {
    for (const [alias, info] of Object.entries(this.links)) {
      const localPath = info.localPath.replace(/\/+$/, "");
      if (value === localPath || value.startsWith(localPath + "/")) {
        return `@@${alias}@@${value.slice(localPath.length)}`;
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
    return info.localPath.replace(/\/+$/, "") + suffix;
  }
}
