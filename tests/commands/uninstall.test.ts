import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { UninstallCommand } from "../../src/commands/uninstall.js";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

describe("UninstallCommand", () => {
  let homeDir: string;
  let claudeDir: string;
  let claudefyDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-uninstall-test-"));
    claudeDir = join(homeDir, ".claude");
    claudefyDir = join(homeDir, ".claudefy");

    // Create ~/.claude with settings.json
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, "settings.json"), JSON.stringify({ theme: "dark" }));

    // Create ~/.claudefy with config
    await mkdir(join(claudefyDir, "backups"), { recursive: true });
    await mkdir(join(claudefyDir, "store"), { recursive: true });
    await writeFile(
      join(claudefyDir, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: "git@github.com:user/repo.git" },
        encryption: { enabled: false, useKeychain: false, cacheDuration: "0" },
        machineId: "test-machine",
      }),
    );
    await writeFile(join(claudefyDir, "machine-id"), "test-machine");
    await writeFile(join(claudefyDir, "links.json"), "{}");
    await writeFile(
      join(claudefyDir, "sync-filter.json"),
      JSON.stringify({ allowlist: ["settings.json"], denylist: [] }),
    );
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  it("removes ~/.claudefy directory with --confirm", async () => {
    const cmd = new UninstallCommand(homeDir);
    await cmd.execute({ confirm: true, quiet: true });

    expect(existsSync(claudefyDir)).toBe(false);
  });

  it("preserves ~/.claude directory", async () => {
    const cmd = new UninstallCommand(homeDir);
    await cmd.execute({ confirm: true, quiet: true });

    expect(existsSync(claudeDir)).toBe(true);
    const settings = JSON.parse(await readFile(join(claudeDir, "settings.json"), "utf-8"));
    expect(settings.theme).toBe("dark");
  });

  it("removes hooks from settings.json if installed", async () => {
    // Write settings with claudefy hooks
    await writeFile(
      join(claudeDir, "settings.json"),
      JSON.stringify({
        theme: "dark",
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "claudefy pull --quiet" }] }],
          SessionEnd: [{ hooks: [{ type: "command", command: "claudefy push --quiet" }] }],
        },
      }),
    );

    const cmd = new UninstallCommand(homeDir);
    await cmd.execute({ confirm: true, quiet: true });

    const settings = JSON.parse(await readFile(join(claudeDir, "settings.json"), "utf-8"));
    expect(settings.hooks).toBeUndefined();
    expect(settings.theme).toBe("dark");
  });

  it("does nothing if claudefy is not installed", async () => {
    await rm(claudefyDir, { recursive: true, force: true });

    const cmd = new UninstallCommand(homeDir);
    // Should not throw
    await cmd.execute({ confirm: true, quiet: true });
  });

  it("handles missing settings.json gracefully", async () => {
    await rm(join(claudeDir, "settings.json"), { force: true });

    const cmd = new UninstallCommand(homeDir);
    // Should not throw
    await cmd.execute({ confirm: true, quiet: true });

    expect(existsSync(claudefyDir)).toBe(false);
  });
});
