import { describe, it, expect } from "vitest";
import { Merger } from "../../src/merger/merger.js";

describe("Merger array dedup", () => {
  const merger = new Merger();

  it("merges primitive string arrays with set union", () => {
    const local = { permissions: { allow: ["a", "b"] } };
    const remote = { permissions: { allow: ["b", "c"] } };
    const result = merger.deepMergeJson(local, remote);
    expect(result.permissions.allow).toEqual(["b", "c", "a"]);
  });

  it("deduplicates identical primitive arrays", () => {
    const local = { items: ["a"] };
    const remote = { items: ["a"] };
    const result = merger.deepMergeJson(local, remote);
    expect(result.items).toEqual(["a"]);
  });

  it("preserves type fidelity — number 1 is not string '1'", () => {
    const local = { items: [1, 2] };
    const remote = { items: [2, "2"] };
    const result = merger.deepMergeJson(local, remote);
    expect(result.items).toEqual([2, "2", 1]);
  });

  it("uses key-based dedup for object arrays with name/id/key", () => {
    const local = { servers: [{ name: "x", port: 1 }] };
    const remote = { servers: [{ name: "y", port: 2 }] };
    const result = merger.deepMergeJson(local, remote);
    expect(result.servers).toEqual([
      { name: "y", port: 2 },
      { name: "x", port: 1 },
    ]);
  });

  it("preserves both items in keyless object arrays", () => {
    const local = { items: [{ foo: "bar" }] };
    const remote = { items: [{ baz: "qux" }] };
    const result = merger.deepMergeJson(local, remote);
    expect(result.items).toEqual([{ baz: "qux" }, { foo: "bar" }]);
  });

  it("handles empty source array", () => {
    const local = { items: ["a"] };
    const remote = { items: [] as string[] };
    const result = merger.deepMergeJson(local, remote);
    expect(result.items).toEqual(["a"]);
  });

  it("handles empty target array", () => {
    const local = { items: [] as string[] };
    const remote = { items: ["a"] };
    const result = merger.deepMergeJson(local, remote);
    expect(result.items).toEqual(["a"]);
  });
});
