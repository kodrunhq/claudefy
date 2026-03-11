import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SyncFilter } from "../../src/sync-filter/sync-filter.js";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_SYNC_FILTER } from "../../src/config/defaults.js";

describe("SyncFilter", () => {
  let tempDir: string;
  let claudeDir: string;
  let syncFilter: SyncFilter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-filter-test-"));
    claudeDir = join(tempDir, ".claude");
    await mkdir(claudeDir);
    syncFilter = new SyncFilter(DEFAULT_SYNC_FILTER);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("classifies allowlisted directories", async () => {
    await mkdir(join(claudeDir, "commands"));
    await writeFile(join(claudeDir, "commands", "test.md"), "# Test");
    await mkdir(join(claudeDir, "agents"));

    const result = await syncFilter.classify(claudeDir);
    const names = result.allowlist.map((i) => i.name);
    expect(names).toContain("commands");
    expect(names).toContain("agents");
  });

  it("classifies denylisted directories", async () => {
    await mkdir(join(claudeDir, "cache"));
    await mkdir(join(claudeDir, "backups"));

    const result = await syncFilter.classify(claudeDir);
    const names = result.denylist.map((i) => i.name);
    expect(names).toContain("cache");
    expect(names).toContain("backups");
  });

  it("classifies unknown items as unknown tier", async () => {
    await mkdir(join(claudeDir, "get-shit-done"));
    await writeFile(join(claudeDir, "some-random-file.json"), "{}");

    const result = await syncFilter.classify(claudeDir);
    const names = result.unknown.map((i) => i.name);
    expect(names).toContain("get-shit-done");
    expect(names).toContain("some-random-file.json");
  });

  it("classifies allowlisted files", async () => {
    await writeFile(join(claudeDir, "settings.json"), "{}");
    await writeFile(join(claudeDir, "history.jsonl"), "");

    const result = await syncFilter.classify(claudeDir);
    const names = result.allowlist.map((i) => i.name);
    expect(names).toContain("settings.json");
    expect(names).toContain("history.jsonl");
  });

  it("classifies denylisted files", async () => {
    await writeFile(join(claudeDir, ".credentials.json"), "{}");

    const result = await syncFilter.classify(claudeDir);
    const names = result.denylist.map((i) => i.name);
    expect(names).toContain(".credentials.json");
  });

  it("respects filter overrides", async () => {
    await mkdir(join(claudeDir, "get-shit-done"));

    const customFilter = {
      ...DEFAULT_SYNC_FILTER,
      allowlist: [...DEFAULT_SYNC_FILTER.allowlist, "get-shit-done"],
    };
    const filter = new SyncFilter(customFilter);
    const result = await filter.classify(claudeDir);
    const names = result.allowlist.map((i) => i.name);
    expect(names).toContain("get-shit-done");
  });

  it("denies .credentials.json even if user adds it to allowlist", async () => {
    await writeFile(join(claudeDir, ".credentials.json"), '{"api_key": "secret"}');

    const customFilter = {
      allowlist: [...DEFAULT_SYNC_FILTER.allowlist, ".credentials.json"],
      denylist: DEFAULT_SYNC_FILTER.denylist.filter((d) => d !== ".credentials.json"),
    };
    const filter = new SyncFilter(customFilter);
    const result = await filter.classify(claudeDir);

    const allowNames = result.allowlist.map((i) => i.name);
    const denyNames = result.denylist.map((i) => i.name);
    expect(allowNames).not.toContain(".credentials.json");
    expect(denyNames).toContain(".credentials.json");
  });
});
