import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GitIdentity } from "../../src/path-mapper/git-identity.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";

describe("GitIdentity", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-git-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects git remote and derives canonical ID", async () => {
    const git = simpleGit(tempDir);
    await git.init();
    await git.addRemote("origin", "git@github.com:kodrunhq/kodrun.git");

    const identity = new GitIdentity();
    const result = await identity.detect(tempDir);
    expect(result).not.toBeNull();
    expect(result!.canonicalId).toBe("github.com--kodrunhq--kodrun");
    expect(result!.gitRemote).toBe("git@github.com:kodrunhq/kodrun.git");
  });

  it("handles HTTPS remote URLs", async () => {
    const git = simpleGit(tempDir);
    await git.init();
    await git.addRemote("origin", "https://github.com/kodrunhq/kodrun.git");

    const identity = new GitIdentity();
    const result = await identity.detect(tempDir);
    expect(result).not.toBeNull();
    expect(result!.canonicalId).toBe("github.com--kodrunhq--kodrun");
  });

  it("returns null for non-git directories", async () => {
    const identity = new GitIdentity();
    const result = await identity.detect(tempDir);
    expect(result).toBeNull();
  });

  it("returns null for repos without remotes", async () => {
    const git = simpleGit(tempDir);
    await git.init();

    const identity = new GitIdentity();
    const result = await identity.detect(tempDir);
    expect(result).toBeNull();
  });

  it("normalizes canonical ID (strips .git suffix, lowercases)", async () => {
    const git = simpleGit(tempDir);
    await git.init();
    await git.addRemote("origin", "git@GitHub.com:KodrunHQ/Kodrun.GIT");

    const identity = new GitIdentity();
    const result = await identity.detect(tempDir);
    expect(result).not.toBeNull();
    expect(result!.canonicalId).toBe("github.com--kodrunhq--kodrun");
  });
});
