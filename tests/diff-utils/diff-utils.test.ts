import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeDiff } from "../../src/diff-utils/diff-utils.js";

describe("computeDiff", () => {
  let tmpDir: string;
  let sourceDir: string;
  let targetDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claudefy-diff-test-"));
    sourceDir = join(tmpDir, "source");
    targetDir = join(tmpDir, "target");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("detects added files (present in source, not in target)", async () => {
    await writeFile(join(sourceDir, "new-file.txt"), "hello");

    const result = await computeDiff(sourceDir, targetDir);

    expect(result.added).toEqual(["new-file.txt"]);
    expect(result.deleted).toEqual([]);
    expect(result.modified).toEqual([]);
    expect(result.hasChanges).toBe(true);
  });

  it("detects deleted files (present in target, not in source)", async () => {
    await writeFile(join(targetDir, "old-file.txt"), "goodbye");

    const result = await computeDiff(sourceDir, targetDir);

    expect(result.added).toEqual([]);
    expect(result.deleted).toEqual(["old-file.txt"]);
    expect(result.modified).toEqual([]);
    expect(result.hasChanges).toBe(true);
  });

  it("detects modified files (content differs)", async () => {
    await writeFile(join(sourceDir, "file.txt"), "version 2");
    await writeFile(join(targetDir, "file.txt"), "version 1");

    const result = await computeDiff(sourceDir, targetDir);

    expect(result.added).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(result.modified).toEqual(["file.txt"]);
    expect(result.hasChanges).toBe(true);
  });

  it("reports no changes when directories are identical", async () => {
    await writeFile(join(sourceDir, "same.txt"), "identical content");
    await writeFile(join(targetDir, "same.txt"), "identical content");

    const result = await computeDiff(sourceDir, targetDir);

    expect(result.added).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(result.modified).toEqual([]);
    expect(result.hasChanges).toBe(false);
  });

  it("handles empty directories", async () => {
    const result = await computeDiff(sourceDir, targetDir);

    expect(result.added).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(result.modified).toEqual([]);
    expect(result.hasChanges).toBe(false);
  });

  it("handles non-existent source directory", async () => {
    const nonExistent = join(tmpDir, "does-not-exist");

    const result = await computeDiff(nonExistent, targetDir);

    expect(result.hasChanges).toBe(false);
  });

  it("handles non-existent target directory", async () => {
    await writeFile(join(sourceDir, "file.txt"), "content");
    const nonExistent = join(tmpDir, "does-not-exist");

    const result = await computeDiff(sourceDir, nonExistent);

    expect(result.added).toEqual(["file.txt"]);
    expect(result.hasChanges).toBe(true);
  });

  it("recurses into subdirectories", async () => {
    await mkdir(join(sourceDir, "sub"), { recursive: true });
    await writeFile(join(sourceDir, "sub", "nested.txt"), "nested content");

    const result = await computeDiff(sourceDir, targetDir);

    expect(result.added).toEqual(["sub/nested.txt"]);
    expect(result.hasChanges).toBe(true);
  });

  it("detects mixed changes across multiple files", async () => {
    // Added
    await writeFile(join(sourceDir, "added.txt"), "new");
    // Deleted
    await writeFile(join(targetDir, "deleted.txt"), "old");
    // Modified
    await writeFile(join(sourceDir, "changed.txt"), "v2");
    await writeFile(join(targetDir, "changed.txt"), "v1");
    // Unchanged
    await writeFile(join(sourceDir, "same.txt"), "same");
    await writeFile(join(targetDir, "same.txt"), "same");

    const result = await computeDiff(sourceDir, targetDir);

    expect(result.added).toEqual(["added.txt"]);
    expect(result.deleted).toEqual(["deleted.txt"]);
    expect(result.modified).toEqual(["changed.txt"]);
    expect(result.hasChanges).toBe(true);
  });

  it("sorts results alphabetically", async () => {
    await writeFile(join(sourceDir, "z-file.txt"), "z");
    await writeFile(join(sourceDir, "a-file.txt"), "a");
    await writeFile(join(sourceDir, "m-file.txt"), "m");

    const result = await computeDiff(sourceDir, targetDir);

    expect(result.added).toEqual(["a-file.txt", "m-file.txt", "z-file.txt"]);
  });
});
