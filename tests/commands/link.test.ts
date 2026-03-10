import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LinkCommand } from "../../src/commands/link.js";
import { ConfigManager } from "../../src/config/config-manager.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { simpleGit } from "simple-git";

describe("LinkCommand", () => {
  let homeDir: string;
  let remoteDir: string;
  let projectDir: string;
  const extraDirs: string[] = [];

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-link-test-"));

    // Initialize claudefy config
    const configManager = new ConfigManager(homeDir);
    remoteDir = await mkdtemp(join(tmpdir(), "claudefy-link-remote-"));
    await simpleGit(remoteDir).init(true, ["-b", "main"]);
    await configManager.initialize(remoteDir);

    // Create a fake project directory with a git repo
    projectDir = await mkdtemp(join(tmpdir(), "claudefy-link-project-"));
    const git = simpleGit(projectDir);
    await git.init();
    await git.addRemote("origin", "https://github.com/test/my-project.git");
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
    for (const dir of extraDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    extraDirs.length = 0;
  });

  it("adds a link", async () => {
    const cmd = new LinkCommand(homeDir);
    await cmd.add("my-project", projectDir);

    const links = await cmd.list();
    expect(links["my-project"]).toBeDefined();
    expect(links["my-project"].localPath).toBe(projectDir);
    expect(links["my-project"].gitRemote).toBe("https://github.com/test/my-project.git");
  });

  it("removes a link", async () => {
    const cmd = new LinkCommand(homeDir);
    await cmd.add("my-project", projectDir);

    // Verify it exists
    let links = await cmd.list();
    expect(links["my-project"]).toBeDefined();

    // Remove it
    await cmd.remove("my-project");

    links = await cmd.list();
    expect(links["my-project"]).toBeUndefined();
  });

  it("lists multiple links", async () => {
    const cmd = new LinkCommand(homeDir);

    // Create a second project directory
    const projectDir2 = await mkdtemp(join(tmpdir(), "claudefy-link-project2-"));
    extraDirs.push(projectDir2);
    const git2 = simpleGit(projectDir2);
    await git2.init();
    await git2.addRemote("origin", "https://github.com/test/other-project.git");

    await cmd.add("project-one", projectDir);
    await cmd.add("project-two", projectDir2);

    const links = await cmd.list();
    expect(Object.keys(links)).toHaveLength(2);
    expect(links["project-one"]).toBeDefined();
    expect(links["project-two"]).toBeDefined();
    expect(links["project-one"].localPath).toBe(projectDir);
    expect(links["project-two"].localPath).toBe(projectDir2);
  });
});
