import { describe, it, expect, vi } from "vitest";
import { RepoCreator } from "../../src/repo-creator/repo-creator.js";

describe("RepoCreator", () => {
  it("detects available provider", async () => {
    const creator = new RepoCreator();
    const provider = await creator.detect();
    expect(provider === "github" || provider === "gitlab" || provider === null).toBe(true);
  });

  it("throws when no CLI is available", async () => {
    const creator = new RepoCreator();
    vi.spyOn(creator as any, "isAvailable").mockResolvedValue(false);
    await expect(creator.create("test-repo")).rejects.toThrow("No supported CLI found");
  });
});
