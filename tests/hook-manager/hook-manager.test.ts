import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { HookManager } from "../../src/hook-manager/hook-manager.js";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("HookManager", () => {
  let tempDir: string;
  let settingsPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-hooks-test-"));
    settingsPath = join(tempDir, "settings.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("installs SessionStart and SessionEnd hooks into empty settings", async () => {
    await writeFile(settingsPath, "{}");

    const manager = new HookManager(settingsPath);
    await manager.install();

    const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
    expect(settings.hooks.SessionStart).toBeDefined();
    expect(settings.hooks.SessionEnd).toBeDefined();

    const startCmd = settings.hooks.SessionStart.find((h: { hooks: { command: string }[] }) =>
      h.hooks.some((hk: { command: string }) => hk.command.includes("claudefy pull")),
    );
    expect(startCmd).toBeDefined();

    const endCmd = settings.hooks.SessionEnd.find((h: { hooks: { command: string }[] }) =>
      h.hooks.some((hk: { command: string }) => hk.command.includes("claudefy push")),
    );
    expect(endCmd).toBeDefined();
  });

  it("installs hooks alongside existing hooks", async () => {
    const existing = {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo existing" }] }],
      },
    };
    await writeFile(settingsPath, JSON.stringify(existing));

    const manager = new HookManager(settingsPath);
    await manager.install();

    const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
    expect(settings.hooks.SessionStart.length).toBe(2);
  });

  it("removes claudefy hooks without touching others", async () => {
    const withHooks = {
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "echo existing" }] },
          { hooks: [{ type: "command", command: "claudefy pull --quiet" }] },
        ],
        SessionEnd: [{ hooks: [{ type: "command", command: "claudefy push --quiet" }] }],
      },
    };
    await writeFile(settingsPath, JSON.stringify(withHooks));

    const manager = new HookManager(settingsPath);
    await manager.remove();

    const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
    expect(settings.hooks.SessionStart.length).toBe(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("echo existing");
    expect(settings.hooks.SessionEnd).toBeUndefined();
  });

  it("installs SessionEnd hook with nohup for detached execution", async () => {
    await writeFile(settingsPath, "{}");

    const manager = new HookManager(settingsPath);
    await manager.install();

    const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
    const endHook = settings.hooks.SessionEnd[0].hooks[0];
    expect(endHook.command).toContain("nohup");
    expect(endHook.command).toContain("&");
  });

  it("removes nohup-wrapped claudefy hooks", async () => {
    const withHooks = {
      hooks: {
        SessionEnd: [
          {
            hooks: [
              {
                type: "command",
                command: "nohup claudefy push --quiet >/dev/null 2>&1 &",
              },
            ],
          },
        ],
      },
    };
    await writeFile(settingsPath, JSON.stringify(withHooks));

    const manager = new HookManager(settingsPath);
    await manager.remove();

    const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
    expect(settings.hooks).toBeUndefined();
  });

  it("upgrades old hook format when install is called again", async () => {
    // Simulate pre-1.5.1 hooks (no nohup)
    const oldHooks = {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "claudefy pull --quiet" }] }],
        SessionEnd: [{ hooks: [{ type: "command", command: "claudefy push --quiet" }] }],
      },
    };
    await writeFile(settingsPath, JSON.stringify(oldHooks));

    const manager = new HookManager(settingsPath);
    await manager.install();

    const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
    // Should have exactly one claudefy hook per event (not duplicated)
    expect(settings.hooks.SessionStart.length).toBe(1);
    expect(settings.hooks.SessionEnd.length).toBe(1);
    // SessionEnd should now use nohup
    expect(settings.hooks.SessionEnd[0].hooks[0].command).toContain("nohup");
  });

  it("preserves non-claudefy hooks during upgrade", async () => {
    const mixed = {
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "echo custom" }] },
          { hooks: [{ type: "command", command: "claudefy pull --quiet" }] },
        ],
        SessionEnd: [{ hooks: [{ type: "command", command: "claudefy push --quiet" }] }],
      },
    };
    await writeFile(settingsPath, JSON.stringify(mixed));

    const manager = new HookManager(settingsPath);
    await manager.install();

    const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
    expect(settings.hooks.SessionStart.length).toBe(2);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("echo custom");
    expect(settings.hooks.SessionStart[1].hooks[0].command).toContain("claudefy pull");
  });

  it("detects if hooks are installed", async () => {
    await writeFile(settingsPath, "{}");
    const manager = new HookManager(settingsPath);

    expect(await manager.isInstalled()).toBe(false);

    await manager.install();
    expect(await manager.isInstalled()).toBe(true);

    await manager.remove();
    expect(await manager.isInstalled()).toBe(false);
  });

  it("does not false-positive on commands that merely mention claudefy pull/push", async () => {
    const withHooks = {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo claudefy pull is great" }] }],
        SessionEnd: [{ hooks: [{ type: "command", command: "echo claudefy push is also great" }] }],
      },
    };
    await writeFile(settingsPath, JSON.stringify(withHooks));

    const manager = new HookManager(settingsPath);
    await manager.remove();

    const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
    expect(settings.hooks.SessionStart.length).toBe(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("echo claudefy pull is great");
    expect(settings.hooks.SessionEnd.length).toBe(1);
    expect(settings.hooks.SessionEnd[0].hooks[0].command).toBe("echo claudefy push is also great");
  });
});
