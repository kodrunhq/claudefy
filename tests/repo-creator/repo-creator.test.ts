import { describe, it, expect, vi } from "vitest";
import { RepoCreator } from "../../src/repo-creator/repo-creator.js";

describe("RepoCreator", () => {
  it("detects github when gh is available", async () => {
    const creator = new RepoCreator();
    vi.spyOn(creator as any, "isAvailable").mockImplementation((cmd: string) =>
      Promise.resolve(cmd === "gh"),
    );
    const provider = await creator.detect();
    expect(provider).toBe("github");
  });

  it("detects gitlab when only glab is available", async () => {
    const creator = new RepoCreator();
    vi.spyOn(creator as any, "isAvailable").mockImplementation((cmd: string) =>
      Promise.resolve(cmd === "glab"),
    );
    const provider = await creator.detect();
    expect(provider).toBe("gitlab");
  });

  it("returns null when no CLI is available", async () => {
    const creator = new RepoCreator();
    vi.spyOn(creator as any, "isAvailable").mockResolvedValue(false);
    const provider = await creator.detect();
    expect(provider).toBeNull();
  });

  it("throws when no CLI is available", async () => {
    const creator = new RepoCreator();
    vi.spyOn(creator as any, "isAvailable").mockResolvedValue(false);
    await expect(creator.create("test-repo")).rejects.toThrow("No supported CLI found");
  });
});
