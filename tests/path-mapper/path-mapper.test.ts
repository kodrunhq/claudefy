import { describe, it, expect } from "vitest";
import { PathMapper } from "../../src/path-mapper/path-mapper.js";
import type { LinksConfig } from "../../src/config/types.js";

describe("PathMapper", () => {
  const links: LinksConfig = {
    kodrun: {
      localPath: "/home/joseibanez/develop/projects/kodrun",
      canonicalId: "github.com--kodrunhq--kodrun",
      gitRemote: "git@github.com:kodrunhq/kodrun.git",
      detectedAt: "2026-03-09T14:00:00Z",
    },
    claudefy: {
      localPath: "/home/joseibanez/develop/projects/claudefy",
      canonicalId: "github.com--kodrunhq--claudefy",
      gitRemote: "git@github.com:kodrunhq/claudefy.git",
      detectedAt: "2026-03-09T14:00:00Z",
    },
  };

  const mapper = new PathMapper(links);

  describe("project directory names", () => {
    it("normalizes directory name to canonical ID on push", () => {
      const result = mapper.normalizeDirName(
        "-home-joseibanez-develop-projects-kodrun"
      );
      expect(result).toBe("github.com--kodrunhq--kodrun");
    });

    it("remaps canonical ID back to local dir name on pull", () => {
      const result = mapper.remapDirName("github.com--kodrunhq--kodrun");
      expect(result).toBe("-home-joseibanez-develop-projects-kodrun");
    });

    it("returns null for unlinked directories on push", () => {
      const result = mapper.normalizeDirName("-home-user-random-project");
      expect(result).toBeNull();
    });

    it("returns null for unlinked canonical IDs on pull", () => {
      const result = mapper.remapDirName("github.com--unknown--repo");
      expect(result).toBeNull();
    });
  });

  describe("history.jsonl path fields", () => {
    it("normalizes project field on push", () => {
      const line = JSON.stringify({
        display: "test",
        project: "/home/joseibanez/develop/projects/kodrun",
        timestamp: 123,
      });
      const result = mapper.normalizeJsonlLine(line);
      const parsed = JSON.parse(result);
      expect(parsed.project).toBe("@@kodrun@@");
    });

    it("remaps project field on pull", () => {
      const line = JSON.stringify({
        display: "test",
        project: "@@kodrun@@",
        timestamp: 123,
      });
      const result = mapper.remapJsonlLine(line);
      const parsed = JSON.parse(result);
      expect(parsed.project).toBe(
        "/home/joseibanez/develop/projects/kodrun"
      );
    });

    it("normalizes cwd field on push", () => {
      const line = JSON.stringify({
        cwd: "/home/joseibanez/develop/projects/kodrun",
        type: "user",
      });
      const result = mapper.normalizeJsonlLine(line);
      const parsed = JSON.parse(result);
      expect(parsed.cwd).toBe("@@kodrun@@");
    });

    it("leaves unlinked paths unchanged", () => {
      const line = JSON.stringify({
        project: "/home/user/unknown-project",
        timestamp: 123,
      });
      const result = mapper.normalizeJsonlLine(line);
      const parsed = JSON.parse(result);
      expect(parsed.project).toBe("/home/user/unknown-project");
    });
  });

  describe("settings.json path remapping", () => {
    it("normalizes absolute paths in hook commands on push", () => {
      const settings = {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    'node "/home/joseibanez/.claude/hooks/gsd-check-update.js"',
                },
              ],
            },
          ],
        },
      };
      const claudeDir = "/home/joseibanez/.claude";
      const result = mapper.normalizeSettingsPaths(settings, claudeDir);
      expect(result.hooks.SessionStart[0].hooks[0].command).toBe(
        'node "@@CLAUDE_DIR@@/hooks/gsd-check-update.js"'
      );
    });

    it("remaps @@CLAUDE_DIR@@ back to local path on pull", () => {
      const settings = {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    'node "@@CLAUDE_DIR@@/hooks/gsd-check-update.js"',
                },
              ],
            },
          ],
        },
      };
      const claudeDir = "/Users/jose/.claude";
      const result = mapper.remapSettingsPaths(settings, claudeDir);
      expect(result.hooks.SessionStart[0].hooks[0].command).toBe(
        'node "/Users/jose/.claude/hooks/gsd-check-update.js"'
      );
    });
  });

  describe("installed_plugins.json path remapping", () => {
    it("normalizes installPath on push", () => {
      const plugins = {
        version: 2,
        plugins: {
          "github@claude-plugins-official": [
            {
              scope: "user",
              installPath:
                "/home/joseibanez/.claude/plugins/cache/claude-plugins-official/github/205b6e0b3036",
              version: "205b6e0b3036",
            },
          ],
        },
      };
      const claudeDir = "/home/joseibanez/.claude";
      const result = mapper.normalizePluginPaths(plugins, claudeDir);
      expect(
        result.plugins["github@claude-plugins-official"][0].installPath
      ).toBe(
        "@@CLAUDE_DIR@@/plugins/cache/claude-plugins-official/github/205b6e0b3036"
      );
    });

    it("remaps installPath on pull", () => {
      const plugins = {
        version: 2,
        plugins: {
          "github@claude-plugins-official": [
            {
              scope: "user",
              installPath:
                "@@CLAUDE_DIR@@/plugins/cache/claude-plugins-official/github/205b6e0b3036",
              version: "205b6e0b3036",
            },
          ],
        },
      };
      const claudeDir = "/Users/jose/.claude";
      const result = mapper.remapPluginPaths(plugins, claudeDir);
      expect(
        result.plugins["github@claude-plugins-official"][0].installPath
      ).toBe(
        "/Users/jose/.claude/plugins/cache/claude-plugins-official/github/205b6e0b3036"
      );
    });
  });
});
