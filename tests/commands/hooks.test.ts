import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { HooksCommand } from "../../src/commands/hooks.js";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("HooksCommand", () => {
  let homeDir: string;
  let claudeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-hooks-test-"));
    claudeDir = join(homeDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, "settings.json"), JSON.stringify({ theme: "dark" }));
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  it("installs hooks into settings.json", async () => {
    const cmd = new HooksCommand(homeDir);
    await cmd.install();

    const settings = JSON.parse(await readFile(join(claudeDir, "settings.json"), "utf-8"));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.SessionStart).toBeDefined();
    expect(settings.hooks.SessionEnd).toBeDefined();

    // Verify the hook commands
    const startHook = settings.hooks.SessionStart[0].hooks[0];
    expect(startHook.command).toContain("claudefy pull");

    const endHook = settings.hooks.SessionEnd[0].hooks[0];
    expect(endHook.command).toContain("claudefy push");

    // Existing content should be preserved
    expect(settings.theme).toBe("dark");
  });

  it("removes hooks from settings.json", async () => {
    const cmd = new HooksCommand(homeDir);
    await cmd.install();

    // Verify installed
    let settings = JSON.parse(await readFile(join(claudeDir, "settings.json"), "utf-8"));
    expect(settings.hooks).toBeDefined();

    // Remove
    await cmd.remove();

    settings = JSON.parse(await readFile(join(claudeDir, "settings.json"), "utf-8"));
    expect(settings.hooks).toBeUndefined();
    // Existing content preserved
    expect(settings.theme).toBe("dark");
  });

  it("isInstalled returns correct state", async () => {
    const cmd = new HooksCommand(homeDir);

    // Not installed yet
    expect(await cmd.isInstalled()).toBe(false);

    // Install
    await cmd.install();
    expect(await cmd.isInstalled()).toBe(true);

    // Remove
    await cmd.remove();
    expect(await cmd.isInstalled()).toBe(false);
  });
});
