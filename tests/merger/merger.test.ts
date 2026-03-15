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

  describe("smart array merge", () => {
    it("unions arrays of objects by 'name' key", () => {
      const local = {
        items: [
          { name: "a", value: 1 },
          { name: "b", value: 2 },
        ],
      };
      const remote = {
        items: [
          { name: "a", value: 10 },
          { name: "c", value: 3 },
        ],
      };
      const result = merger.deepMergeJson(local, remote);
      expect(result.items).toEqual([
        { name: "a", value: 10 },
        { name: "c", value: 3 },
        { name: "b", value: 2 },
      ]);
    });

    it("unions arrays of objects by 'id' key", () => {
      const local = { items: [{ id: "1", data: "local" }] };
      const remote = { items: [{ id: "2", data: "remote" }] };
      const result = merger.deepMergeJson(local, remote);
      expect(result.items).toEqual([
        { id: "2", data: "remote" },
        { id: "1", data: "local" },
      ]);
    });

    it("unions primitive arrays preserving local-only entries", () => {
      const local = { tags: ["a", "b", "c"] };
      const remote = { tags: ["x", "y"] };
      const result = merger.deepMergeJson(local, remote);
      expect(result.tags).toEqual(["x", "y", "a", "b", "c"]);
    });

    it("preserves local entries for keyless object arrays via JSON dedup", () => {
      const local = { items: [{ value: 1 }, { value: 2 }] };
      const remote = { items: [{ value: 3 }] };
      const result = merger.deepMergeJson(local, remote);
      expect(result.items).toEqual([{ value: 3 }, { value: 1 }, { value: 2 }]);
    });

    it("preserves local entries when remote array is empty", () => {
      const local = { items: [{ name: "a", value: 1 }] };
      const remote = { items: [] };
      const result = merger.deepMergeJson(local, remote);
      expect(result.items).toEqual([{ name: "a", value: 1 }]);
    });
  });
});
