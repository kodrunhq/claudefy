import { readFileSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { output } from "../output.js";

export interface ClaudeJsonSyncOptions {
  claudeJsonPath: string;
  storePath: string;
  homeDir: string;
  syncMcpServers: boolean;
}

const ALWAYS_SYNCABLE_KEYS = ["theme", "preferredNotifChannel"];
const OPT_IN_SYNCABLE_KEYS = ["mcpServers"];

export class ClaudeJsonSync {
  extract(options: ClaudeJsonSyncOptions): Record<string, unknown> {
    if (!existsSync(options.claudeJsonPath)) return {};

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(readFileSync(options.claudeJsonPath, "utf-8"));
    } catch (err) {
      output.warn(`Could not parse ~/.claude.json — skipping sync: ${(err as Error).message}`);
      return {};
    }

    const result: Record<string, unknown> = {};

    for (const key of ALWAYS_SYNCABLE_KEYS) {
      if (key in parsed) {
        result[key] = parsed[key];
      }
    }

    if (options.syncMcpServers) {
      for (const key of OPT_IN_SYNCABLE_KEYS) {
        if (key in parsed) {
          result[key] = this.canonicalizePaths(parsed[key], options.homeDir);
        }
      }
    }

    return result;
  }

  merge(options: ClaudeJsonSyncOptions): Record<string, unknown> {
    let local: Record<string, unknown> = {};
    if (existsSync(options.claudeJsonPath)) {
      try {
        local = JSON.parse(readFileSync(options.claudeJsonPath, "utf-8"));
      } catch (err) {
        output.warn(
          `Could not parse local ~/.claude.json — using empty base: ${(err as Error).message}`,
        );
      }
    }

    if (!existsSync(options.storePath)) {
      return local;
    }

    let remote: Record<string, unknown>;
    try {
      remote = JSON.parse(readFileSync(options.storePath, "utf-8"));
    } catch (err) {
      output.warn(
        `Could not parse stored claude-json-sync.json — skipping merge: ${(err as Error).message}`,
      );
      return local;
    }

    const result = { ...local };
    for (const key of ALWAYS_SYNCABLE_KEYS) {
      if (key in remote) {
        result[key] = remote[key];
      }
    }

    if (options.syncMcpServers && "mcpServers" in remote) {
      const localServers = (local.mcpServers ?? {}) as Record<string, unknown>;
      const remoteServers = this.localizePaths(remote.mcpServers, options.homeDir) as Record<
        string,
        unknown
      >;

      // Validate remote MCP server entries before merging
      const shellMetacharPattern = /[;&|`$><\n\r(){}*\\]/;
      const validatedServers: Record<string, unknown> = {};
      for (const [name, cfg] of Object.entries(remoteServers)) {
        const server = cfg as Record<string, unknown>;
        if (typeof server.command === "string" && shellMetacharPattern.test(server.command)) {
          output.warn(
            `Skipping remote MCP server "${name}": command contains shell metacharacters`,
          );
          continue;
        }
        // Reject commands where @@HOME@@ sentinel was not resolved (e.g. path traversal rejected)
        if (typeof server.command === "string" && server.command.includes("@@HOME@@")) {
          output.warn(
            `Skipping remote MCP server "${name}": command contains unresolved path sentinel`,
          );
          continue;
        }
        // Also validate args array entries for shell metacharacters
        if (Array.isArray(server.args)) {
          const unsafeArg = (server.args as unknown[]).find(
            (arg) => typeof arg === "string" && shellMetacharPattern.test(arg),
          );
          if (unsafeArg) {
            output.warn(`Skipping remote MCP server "${name}": args contain shell metacharacters`);
            continue;
          }
        }
        validatedServers[name] = server;
      }

      result.mcpServers = { ...localServers, ...validatedServers };
    }

    return result;
  }

  private canonicalizePaths(obj: unknown, homeDir: string): unknown {
    if (typeof obj === "string") {
      return obj === homeDir || obj.startsWith(homeDir + sep) || obj.startsWith(homeDir + "/")
        ? "@@HOME@@" + obj.slice(homeDir.length)
        : obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.canonicalizePaths(item, homeDir));
    }
    if (obj !== null && typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[key] = this.canonicalizePaths(value, homeDir);
      }
      return result;
    }
    return obj;
  }

  private localizePaths(obj: unknown, homeDir: string): unknown {
    if (typeof obj === "string" && obj.startsWith("@@HOME@@")) {
      const expanded = homeDir + obj.slice("@@HOME@@".length);
      const resolved = resolve(expanded);
      // Prevent path traversal — resolved path must stay within homeDir
      const rel = relative(homeDir, resolved);
      if (rel && (rel.startsWith("..") || isAbsolute(rel))) {
        output.warn(`Skipping unsafe @@HOME@@ path: ${obj}`);
        return obj;
      }
      return resolved;
    }
    if (typeof obj === "string") {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.localizePaths(item, homeDir));
    }
    if (obj !== null && typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[key] = this.localizePaths(value, homeDir);
      }
      return result;
    }
    return obj;
  }
}
