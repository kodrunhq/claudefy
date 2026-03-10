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
    return this.replaceInSerialized(settings, claudeDir, CLAUDE_DIR_SENTINEL);
  }

  remapSettingsPaths<T>(settings: T, claudeDir: string): T {
    return this.replaceInSerialized(settings, CLAUDE_DIR_SENTINEL, claudeDir);
  }

  normalizePluginPaths<T>(plugins: T, claudeDir: string): T {
    return this.replaceInSerialized(plugins, claudeDir, CLAUDE_DIR_SENTINEL);
  }

  remapPluginPaths<T>(plugins: T, claudeDir: string): T {
    return this.replaceInSerialized(plugins, CLAUDE_DIR_SENTINEL, claudeDir);
  }

  private replaceInSerialized<T>(value: T, search: string, replacement: string): T {
    const json = JSON.stringify(value);
    const updated = json.replaceAll(search, replacement);
    return JSON.parse(updated) as T;
  }

  private pathToDirName(localPath: string): string {
    // Claude Code encodes paths by replacing / with -
    // e.g. /home/user/project -> -home-user-project
    return localPath.replace(/\//g, "-");
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
