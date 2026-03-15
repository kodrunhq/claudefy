import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeJsonSync } from "../../src/claude-json-sync/claude-json-sync.js";

describe("ClaudeJsonSync", () => {
  let tempDir: string;
  let homeDir: string;
  let storeDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-claude-json-test-"));
    homeDir = tempDir;
    storeDir = join(tempDir, "store");
    await mkdir(storeDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("extract", () => {
    it("extracts only syncable keys from full claude.json", async () => {
      const claudeJson = {
        mcpServers: { github: { command: "npx", args: ["mcp-github"] } },
        theme: "dark",
        preferredNotifChannel: "toast",
        oauthAccount: { accountUuid: "secret-uuid" },
        projects: { "/Users/jose/project": { allowedTools: [] } },
        cachedStatsigGates: { flag1: true },
        numStartups: 42,
      };
      await writeFile(join(homeDir, ".claude.json"), JSON.stringify(claudeJson));

      const sync = new ClaudeJsonSync();
      const result = sync.extract({
        claudeJsonPath: join(homeDir, ".claude.json"),
        storePath: join(storeDir, "claude-json-sync.json"),
        homeDir,
        syncMcpServers: true,
      });

      expect(result.theme).toBe("dark");
      expect(result.preferredNotifChannel).toBe("toast");
      expect(result.mcpServers).toBeDefined();
      expect(result.oauthAccount).toBeUndefined();
      expect(result.projects).toBeUndefined();
      expect(result.cachedStatsigGates).toBeUndefined();
      expect(result.numStartups).toBeUndefined();
    });

    it("excludes mcpServers when syncMcpServers is false", async () => {
      const claudeJson = { mcpServers: { github: { command: "npx" } }, theme: "dark" };
      await writeFile(join(homeDir, ".claude.json"), JSON.stringify(claudeJson));

      const sync = new ClaudeJsonSync();
      const result = sync.extract({
        claudeJsonPath: join(homeDir, ".claude.json"),
        storePath: join(storeDir, "claude-json-sync.json"),
        homeDir,
        syncMcpServers: false,
      });

      expect(result.mcpServers).toBeUndefined();
      expect(result.theme).toBe("dark");
    });

    it("canonicalizes home directory paths with @@HOME@@ sentinel", async () => {
      const claudeJson = {
        mcpServers: { local: { command: join(homeDir, ".local/bin/mcp-server") } },
      };
      await writeFile(join(homeDir, ".claude.json"), JSON.stringify(claudeJson));

      const sync = new ClaudeJsonSync();
      const result = sync.extract({
        claudeJsonPath: join(homeDir, ".claude.json"),
        storePath: join(storeDir, "claude-json-sync.json"),
        homeDir,
        syncMcpServers: true,
      });

      const servers = result.mcpServers as Record<string, { command: string }>;
      expect(servers.local.command).toBe("@@HOME@@/.local/bin/mcp-server");
    });

    it("returns empty object when file does not exist", () => {
      const sync = new ClaudeJsonSync();
      const result = sync.extract({
        claudeJsonPath: join(homeDir, ".claude.json"),
        storePath: join(storeDir, "claude-json-sync.json"),
        homeDir,
        syncMcpServers: true,
      });
      expect(result).toEqual({});
    });

    it("returns empty object on malformed JSON", async () => {
      await writeFile(join(homeDir, ".claude.json"), "not valid json{{{");
      const sync = new ClaudeJsonSync();
      const result = sync.extract({
        claudeJsonPath: join(homeDir, ".claude.json"),
        storePath: join(storeDir, "claude-json-sync.json"),
        homeDir,
        syncMcpServers: true,
      });
      expect(result).toEqual({});
    });
  });

  describe("merge", () => {
    it("adds remote-only MCP server to local", async () => {
      const local = { theme: "light" };
      const remote = {
        mcpServers: { github: { command: "npx", args: ["mcp-github"] } },
        theme: "dark",
      };
      await writeFile(join(homeDir, ".claude.json"), JSON.stringify(local));
      await writeFile(join(storeDir, "claude-json-sync.json"), JSON.stringify(remote));

      const sync = new ClaudeJsonSync();
      const result = sync.merge({
        claudeJsonPath: join(homeDir, ".claude.json"),
        storePath: join(storeDir, "claude-json-sync.json"),
        homeDir,
        syncMcpServers: true,
      });

      expect(result.mcpServers).toEqual({ github: { command: "npx", args: ["mcp-github"] } });
      expect(result.theme).toBe("dark");
    });

    it("preserves local-only MCP server — no deletions", async () => {
      const local = { mcpServers: { slack: { command: "npx", args: ["mcp-slack"] } } };
      const remote = { mcpServers: { github: { command: "npx", args: ["mcp-github"] } } };
      await writeFile(join(homeDir, ".claude.json"), JSON.stringify(local));
      await writeFile(join(storeDir, "claude-json-sync.json"), JSON.stringify(remote));

      const sync = new ClaudeJsonSync();
      const result = sync.merge({
        claudeJsonPath: join(homeDir, ".claude.json"),
        storePath: join(storeDir, "claude-json-sync.json"),
        homeDir,
        syncMcpServers: true,
      });

      const servers = result.mcpServers as Record<string, unknown>;
      expect(servers.slack).toBeDefined();
      expect(servers.github).toBeDefined();
    });

    it("remote config wins on overlapping server name", async () => {
      const local = { mcpServers: { github: { command: "old-cmd" } } };
      const remote = { mcpServers: { github: { command: "new-cmd", args: ["--flag"] } } };
      await writeFile(join(homeDir, ".claude.json"), JSON.stringify(local));
      await writeFile(join(storeDir, "claude-json-sync.json"), JSON.stringify(remote));

      const sync = new ClaudeJsonSync();
      const result = sync.merge({
        claudeJsonPath: join(homeDir, ".claude.json"),
        storePath: join(storeDir, "claude-json-sync.json"),
        homeDir,
        syncMcpServers: true,
      });

      const servers = result.mcpServers as Record<string, { command: string }>;
      expect(servers.github.command).toBe("new-cmd");
    });

    it("localizes @@HOME@@ sentinel to local home dir", async () => {
      const remote = { mcpServers: { local: { command: "@@HOME@@/.local/bin/server" } } };
      await writeFile(join(homeDir, ".claude.json"), "{}");
      await writeFile(join(storeDir, "claude-json-sync.json"), JSON.stringify(remote));

      const sync = new ClaudeJsonSync();
      const result = sync.merge({
        claudeJsonPath: join(homeDir, ".claude.json"),
        storePath: join(storeDir, "claude-json-sync.json"),
        homeDir,
        syncMcpServers: true,
      });

      const servers = result.mcpServers as Record<string, { command: string }>;
      expect(servers.local.command).toBe(join(homeDir, ".local/bin/server"));
    });

    it("skips MCP merge when syncMcpServers is false", async () => {
      const local = { theme: "light" };
      const remote = { mcpServers: { github: { command: "npx" } }, theme: "dark" };
      await writeFile(join(homeDir, ".claude.json"), JSON.stringify(local));
      await writeFile(join(storeDir, "claude-json-sync.json"), JSON.stringify(remote));

      const sync = new ClaudeJsonSync();
      const result = sync.merge({
        claudeJsonPath: join(homeDir, ".claude.json"),
        storePath: join(storeDir, "claude-json-sync.json"),
        homeDir,
        syncMcpServers: false,
      });

      expect(result.mcpServers).toBeUndefined();
      expect(result.theme).toBe("dark");
    });

    it("returns local content when store file is missing", async () => {
      const local = { theme: "light", oauthAccount: { uuid: "secret" } };
      await writeFile(join(homeDir, ".claude.json"), JSON.stringify(local));

      const sync = new ClaudeJsonSync();
      const result = sync.merge({
        claudeJsonPath: join(homeDir, ".claude.json"),
        storePath: join(storeDir, "nonexistent.json"),
        homeDir,
        syncMcpServers: true,
      });

      expect(result.theme).toBe("light");
      expect(result.oauthAccount).toEqual({ uuid: "secret" });
    });

    it("empty remote mcpServers does not delete local servers", async () => {
      const local = { mcpServers: { slack: { command: "npx", args: ["mcp-slack"] } } };
      const remote = { mcpServers: {} };
      await writeFile(join(homeDir, ".claude.json"), JSON.stringify(local));
      await writeFile(join(storeDir, "claude-json-sync.json"), JSON.stringify(remote));

      const sync = new ClaudeJsonSync();
      const result = sync.merge({
        claudeJsonPath: join(homeDir, ".claude.json"),
        storePath: join(storeDir, "claude-json-sync.json"),
        homeDir,
        syncMcpServers: true,
      });

      const servers = result.mcpServers as Record<string, unknown>;
      expect(servers.slack).toBeDefined();
    });

    it("handles malformed store JSON gracefully", async () => {
      await writeFile(join(homeDir, ".claude.json"), JSON.stringify({ theme: "light" }));
      await writeFile(join(storeDir, "claude-json-sync.json"), "not valid json{{{");

      const sync = new ClaudeJsonSync();
      const result = sync.merge({
        claudeJsonPath: join(homeDir, ".claude.json"),
        storePath: join(storeDir, "claude-json-sync.json"),
        homeDir,
        syncMcpServers: true,
      });

      expect(result.theme).toBe("light");
    });
  });

  describe("security", () => {
    it("blocks path traversal via @@HOME@@ sentinel", async () => {
      const remote = {
        mcpServers: { evil: { command: "@@HOME@@/../../../usr/bin/evil" } },
      };
      await writeFile(join(homeDir, ".claude.json"), "{}");
      await writeFile(join(storeDir, "claude-json-sync.json"), JSON.stringify(remote));

      const sync = new ClaudeJsonSync();
      const result = sync.merge({
        claudeJsonPath: join(homeDir, ".claude.json"),
        storePath: join(storeDir, "claude-json-sync.json"),
        homeDir,
        syncMcpServers: true,
      });

      const servers = result.mcpServers as Record<string, { command: string }>;
      // Path traversal must be blocked — command should retain the raw sentinel, not resolve to a real path
      expect(servers.evil.command).toContain("@@HOME@@");
      // The resolved path must NOT be a valid filesystem path outside homeDir
      const { resolve: pathResolve } = await import("node:path");
      const resolved = pathResolve(servers.evil.command);
      expect(resolved).not.toBe("/usr/bin/evil");
    });

    it("rejects MCP server commands with shell metacharacters", async () => {
      const remote = {
        mcpServers: {
          safe: { command: "npx", args: ["mcp-github"] },
          malicious: { command: "npx; rm -rf /", args: [] },
        },
      };
      await writeFile(join(homeDir, ".claude.json"), "{}");
      await writeFile(join(storeDir, "claude-json-sync.json"), JSON.stringify(remote));

      const sync = new ClaudeJsonSync();
      const result = sync.merge({
        claudeJsonPath: join(homeDir, ".claude.json"),
        storePath: join(storeDir, "claude-json-sync.json"),
        homeDir,
        syncMcpServers: true,
      });

      const servers = result.mcpServers as Record<string, unknown>;
      expect(servers.safe).toBeDefined();
      expect(servers.malicious).toBeUndefined();
    });

    it("rejects MCP server args with shell metacharacters", async () => {
      const remote = {
        mcpServers: {
          safe: { command: "npx", args: ["mcp-github"] },
          argsInjection: { command: "npx", args: ["; rm -rf /"] },
        },
      };
      await writeFile(join(homeDir, ".claude.json"), "{}");
      await writeFile(join(storeDir, "claude-json-sync.json"), JSON.stringify(remote));

      const sync = new ClaudeJsonSync();
      const result = sync.merge({
        claudeJsonPath: join(homeDir, ".claude.json"),
        storePath: join(storeDir, "claude-json-sync.json"),
        homeDir,
        syncMcpServers: true,
      });

      const servers = result.mcpServers as Record<string, unknown>;
      expect(servers.safe).toBeDefined();
      expect(servers.argsInjection).toBeUndefined();
    });
  });

  describe("path canonicalization", () => {
    it("canonicalizes home paths inside args arrays", async () => {
      const claudeJson = {
        mcpServers: {
          local: {
            command: "node",
            args: [
              join(homeDir, ".local/bin/wrapper.js"),
              "--config",
              join(homeDir, ".config/mcp.json"),
            ],
          },
        },
      };
      await writeFile(join(homeDir, ".claude.json"), JSON.stringify(claudeJson));

      const sync = new ClaudeJsonSync();
      const result = sync.extract({
        claudeJsonPath: join(homeDir, ".claude.json"),
        storePath: join(storeDir, "claude-json-sync.json"),
        homeDir,
        syncMcpServers: true,
      });

      const servers = result.mcpServers as Record<string, { args: string[] }>;
      expect(servers.local.args[0]).toBe("@@HOME@@/.local/bin/wrapper.js");
      expect(servers.local.args[1]).toBe("--config");
      expect(servers.local.args[2]).toBe("@@HOME@@/.config/mcp.json");
    });
  });
});
