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
    await bareGit.init(true);

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
    await writeFile(
      join(storePath, "config", "commands", "test.md"),
      "# Test"
    );

    await adapter.commitAndPush("test: add command");

    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-verify-"));
    const verifyGit = simpleGit(verifyDir);
    await verifyGit.clone(remoteDir, "store");
    const content = await readFile(
      join(verifyDir, "store", "config", "commands", "test.md"),
      "utf-8"
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
    const content = await readFile(
      join(adapter.getStorePath(), "test-file.txt"),
      "utf-8"
    );
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

  it("force pushes on override", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    const storePath = adapter.getStorePath();
    await writeFile(join(storePath, "data.txt"), "original");
    await adapter.commitAndPush("original data");

    await adapter.wipeAndPush("override-machine");

    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-verify-"));
    await simpleGit(verifyDir).clone(remoteDir, "store");
    const override = await readFile(
      join(verifyDir, "store", ".override"),
      "utf-8"
    );
    expect(JSON.parse(override).machine).toBe("override-machine");
    await rm(verifyDir, { recursive: true, force: true });
  });
});
