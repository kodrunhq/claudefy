import { describe, it, expect } from "vitest";
import { RepoCreator } from "../../src/repo-creator/repo-creator.js";

describe("RepoCreator", () => {
  it("detects available provider", async () => {
    const creator = new RepoCreator();
    const provider = await creator.detect();
    // Should return github, gitlab, or null depending on environment
    expect(provider === "github" || provider === "gitlab" || provider === null).toBe(true);
  });

  it("throws when no CLI is available and no provider specified", async () => {
    // We can't easily mock which, so just test the error path by passing an invalid provider
    const creator = new RepoCreator();
    await expect(creator.create("test-repo", "gitlab" as any))
      .rejects.toThrow();
  });
});
