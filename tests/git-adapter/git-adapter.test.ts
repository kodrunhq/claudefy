import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GitAdapter } from "../../src/git-adapter/git-adapter.js";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";

describe("GitAdapter", () => {
  let remoteDir: string;
  let localDir: string;

  beforeEach(async () => {
    remoteDir = await mkdtemp(join(tmpdir(), "claudefy-remote-"));
    const bareGit = simpleGit(remoteDir);
    await bareGit.init(true, ["-b", "main"]);

    localDir = await mkdtemp(join(tmpdir(), "claudefy-local-"));
  });

  afterEach(async () => {
    await rm(remoteDir, { recursive: true, force: true });
    await rm(localDir, { recursive: true, force: true });
  });

  it("initializes a store by cloning", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    const git = simpleGit(join(localDir, "store"));
    const isRepo = await git.checkIsRepo();
    expect(isRepo).toBe(true);
  });

  it("writes files and pushes", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    const storePath = adapter.getStorePath();
    await mkdir(join(storePath, "config", "commands"), { recursive: true });
    await writeFile(join(storePath, "config", "commands", "test.md"), "# Test");

    await adapter.commitAndPush("test: add command");

    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-verify-"));
    const verifyGit = simpleGit(verifyDir);
    await verifyGit.clone(remoteDir, "store");
    const content = await readFile(
      join(verifyDir, "store", "config", "commands", "test.md"),
      "utf-8",
    );
    expect(content).toBe("# Test");
    await rm(verifyDir, { recursive: true, force: true });
  });

  it("pulls changes from remote", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    const otherDir = await mkdtemp(join(tmpdir(), "claudefy-other-"));
    const otherGit = simpleGit(otherDir);
    await otherGit.clone(remoteDir, "store");
    const otherStore = join(otherDir, "store");
    await writeFile(join(otherStore, "test-file.txt"), "from other machine");
    await simpleGit(otherStore).add(".").commit("add test file").push();

    await adapter.pull();
    const content = await readFile(join(adapter.getStorePath(), "test-file.txt"), "utf-8");
    expect(content).toBe("from other machine");

    await rm(otherDir, { recursive: true, force: true });
  });

  it("detects override marker", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    await adapter.writeOverrideMarker("nuc-i7");
    await adapter.commitAndPush("override from nuc-i7");

    const otherDir = await mkdtemp(join(tmpdir(), "claudefy-other-"));
    const otherAdapter = new GitAdapter(otherDir);
    await otherAdapter.initStore(remoteDir);

    const override = await otherAdapter.checkOverrideMarker();
    expect(override).not.toBeNull();
    expect(override!.machine).toBe("nuc-i7");

    await rm(otherDir, { recursive: true, force: true });
  });

  it("ensureMachineBranch creates and switches to machine branch", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    await adapter.ensureMachineBranch("laptop-1");
    const branch = await adapter.getCurrentBranch();
    expect(branch).toBe("machines/laptop-1");
  });

  it("ensureMachineBranch checks out existing local branch", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    await adapter.ensureMachineBranch("laptop-1");
    // Switch away
    const storeGit = simpleGit(adapter.getStorePath());
    await storeGit.checkout("main");
    expect(await adapter.getCurrentBranch()).toBe("main");

    // Should checkout existing branch, not create new
    await adapter.ensureMachineBranch("laptop-1");
    expect(await adapter.getCurrentBranch()).toBe("machines/laptop-1");
  });

  it("getCurrentBranch returns correct branch name", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    expect(await adapter.getCurrentBranch()).toBe("main");

    await adapter.ensureMachineBranch("test-machine");
    expect(await adapter.getCurrentBranch()).toBe("machines/test-machine");
  });

  it("commitAndPush with machineId commits to machine branch AND merges to main", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);
    await adapter.ensureMachineBranch("dev-box");

    const storePath = adapter.getStorePath();
    await writeFile(join(storePath, "feature.txt"), "new feature");

    const result = await adapter.commitAndPush("feat: add feature", "dev-box");

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);
    expect(result.mergedToMain).toBe(true);

    // Should be back on machine branch
    expect(await adapter.getCurrentBranch()).toBe("machines/dev-box");

    // Verify main has the file too
    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-verify-"));
    await simpleGit(verifyDir).clone(remoteDir, "store", ["-b", "main"]);
    const content = await readFile(join(verifyDir, "store", "feature.txt"), "utf-8");
    expect(content).toBe("new feature");
    await rm(verifyDir, { recursive: true, force: true });
  });

  it("commitAndPush returns committed=false when store is clean", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    const result = await adapter.commitAndPush("nothing changed");
    expect(result.committed).toBe(false);
    expect(result.pushed).toBe(false);
    expect(result.mergedToMain).toBe(false);
  });

  it("isClean detects untracked files without staging them", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    const storePath = adapter.getStorePath();
    await writeFile(join(storePath, "untracked.txt"), "untracked");

    await expect(adapter.isClean()).resolves.toBe(false);

    const status = await simpleGit(storePath).status();
    expect(status.not_added).toContain("untracked.txt");
    expect(status.staged).toEqual([]);
  });

  it("commitAndPush without machineId behaves like legacy mode", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    const storePath = adapter.getStorePath();
    await writeFile(join(storePath, "data.txt"), "some data");

    const result = await adapter.commitAndPush("add data");
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);
    expect(result.mergedToMain).toBe(false);
  });

  it("pullAndMergeMain merges main changes into machine branch", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    // Create machine branch and push something
    await adapter.ensureMachineBranch("machine-a");
    await writeFile(join(adapter.getStorePath(), "machine-file.txt"), "from machine");
    await adapter.commitAndPush("machine commit", "machine-a");

    // Simulate another machine pushing to main via a separate clone
    const otherDir = await mkdtemp(join(tmpdir(), "claudefy-other-"));
    const otherGit = simpleGit(otherDir);
    await otherGit.clone(remoteDir, "store");
    await writeFile(join(otherDir, "store", "main-file.txt"), "from main");
    await simpleGit(join(otherDir, "store")).add(".").commit("main commit").push();

    // Now pullAndMergeMain should bring that change into machine branch
    await adapter.pullAndMergeMain();

    expect(await adapter.getCurrentBranch()).toBe("machines/machine-a");
    const content = await readFile(join(adapter.getStorePath(), "main-file.txt"), "utf-8");
    expect(content).toBe("from main");

    await rm(otherDir, { recursive: true, force: true });
  });

  it("force pushes on override", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    const storePath = adapter.getStorePath();
    await writeFile(join(storePath, "data.txt"), "original");
    await adapter.commitAndPush("original data");

    await adapter.wipeAndPush("override-machine");

    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-verify-"));
    await simpleGit(verifyDir).clone(remoteDir, "store");
    const override = await readFile(join(verifyDir, "store", ".override"), "utf-8");
    expect(JSON.parse(override).machine).toBe("override-machine");
    await rm(verifyDir, { recursive: true, force: true });
  });

  it("wipeAndPush on machine branch force-updates main to match", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    // Add some data on main first
    const storePath = adapter.getStorePath();
    await writeFile(join(storePath, "old-data.txt"), "should be wiped");
    await adapter.commitAndPush("add old data");

    // Switch to machine branch and wipe
    await adapter.ensureMachineBranch("wipe-machine");
    await adapter.wipeAndPush("wipe-machine");

    // Verify main was force-updated — old-data.txt should be gone, .override should exist
    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-verify-"));
    await simpleGit(verifyDir).clone(remoteDir, "store", ["-b", "main"]);
    const override = await readFile(join(verifyDir, "store", ".override"), "utf-8");
    expect(JSON.parse(override).machine).toBe("wipe-machine");

    const { existsSync } = await import("node:fs");
    expect(existsSync(join(verifyDir, "store", "old-data.txt"))).toBe(false);

    // Should be back on machine branch
    expect(await adapter.getCurrentBranch()).toBe("machines/wipe-machine");

    await rm(verifyDir, { recursive: true, force: true });
  });

  it("returns pushed=false and captures pushError when push is rejected", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);
    await adapter.ensureMachineBranch("push-fail-machine");

    // Step 1: Push an initial commit so the machine branch exists on remote
    await writeFile(join(localDir, "store", "first.txt"), "first");
    const localGit = simpleGit(join(localDir, "store"));
    await localGit.add(".");
    await localGit.commit("first commit");
    await localGit.push(["-u", "origin", "machines/push-fail-machine"]);

    // Step 2: Clone remote in another dir and push a diverging commit to same machine branch
    const otherDir = await mkdtemp(join(tmpdir(), "claudefy-diverge-"));
    try {
      const otherGit = simpleGit(otherDir);
      await otherGit.clone(remoteDir, ".");
      await otherGit.checkout([
        "-b",
        "machines/push-fail-machine",
        "origin/machines/push-fail-machine",
      ]);
      await writeFile(join(otherDir, "diverge.txt"), "diverge");
      await otherGit.add(".");
      await otherGit.commit("diverging commit");
      await otherGit.push("origin", "machines/push-fail-machine");
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }

    // Step 3: Local is now behind remote. Add an uncommitted file and let commitAndPush handle it.
    await writeFile(join(localDir, "store", "local-after-diverge.txt"), "local");

    // commitAndPush should commit the new file and then fail the push (non-fast-forward)
    const result = await adapter.commitAndPush("should fail push", "push-fail-machine");

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.pushError).toBeDefined();
  });
});
