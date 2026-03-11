import { describe, it, expect } from "vitest";
import { Merger } from "../../src/merger/merger.js";

describe("Merger", () => {
  const merger = new Merger();

  describe("deep JSON merge (settings.json)", () => {
    it("merges non-overlapping keys", () => {
      const local = { hooks: { SessionStart: [] }, enabledPlugins: { a: true } };
      const remote = { hooks: { SessionEnd: [] }, enabledPlugins: { b: true } };

      const result = merger.deepMergeJson(local, remote);
      expect(result.hooks.SessionStart).toEqual([]);
      expect(result.hooks.SessionEnd).toEqual([]);
      expect(result.enabledPlugins.a).toBe(true);
      expect(result.enabledPlugins.b).toBe(true);
    });

    it("remote wins on same-key conflict", () => {
      const local = { enabledPlugins: { a: true } };
      const remote = { enabledPlugins: { a: false } };

      const result = merger.deepMergeJson(local, remote);
      expect(result.enabledPlugins.a).toBe(false);
    });

    it("preserves nested structure", () => {
      const local = {
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "local-cmd" }] }],
        },
      };
      const remote = {
        hooks: {
          PostToolUse: [{ hooks: [{ type: "command", command: "remote-cmd" }] }],
        },
      };

      const result = merger.deepMergeJson(local, remote);
      expect(result.hooks.SessionStart).toBeDefined();
      expect(result.hooks.PostToolUse).toBeDefined();
    });
  });
});
