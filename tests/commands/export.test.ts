import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ExportCommand } from "../../src/commands/export.js";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import { CLAUDEFY_DIR } from "../../src/config/defaults.js";

describe("ExportCommand", () => {
  let homeDir: string;
  let claudeDir: string;
  let claudefyDir: string;
  let outputPath: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-export-test-"));
    claudeDir = join(homeDir, ".claude");
    claudefyDir = join(homeDir, CLAUDEFY_DIR);

    // Create ~/.claude with content
    await mkdir(join(claudeDir, "commands"), { recursive: true });
    await writeFile(join(claudeDir, "commands", "test.md"), "# Test Command");
    await writeFile(join(claudeDir, "settings.json"), JSON.stringify({ theme: "dark" }));
    // Create a denied file
    await writeFile(join(claudeDir, ".credentials.json"), "secret");

    // Create ~/.claudefy config
    await mkdir(claudefyDir, { recursive: true });
    await writeFile(
      join(claudefyDir, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: "git@github.com:user/repo.git" },
        encryption: { enabled: false, useKeychain: false, cacheDuration: "0" },
        machineId: "test-machine",
      }),
    );
    await writeFile(
      join(claudefyDir, "sync-filter.json"),
      JSON.stringify({
        allowlist: ["settings.json", "commands"],
        denylist: ["cache"],
      }),
    );

    outputPath = join(homeDir, "export.tar.gz");
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  it("creates a tar.gz archive with allowed and unknown files", async () => {
    const cmd = new ExportCommand(homeDir);
    await cmd.execute({ output: outputPath, quiet: true });

    expect(existsSync(outputPath)).toBe(true);

    // Extract and verify contents
    const extractDir = await mkdtemp(join(tmpdir(), "claudefy-export-verify-"));
    await execFileAsync("tar", ["-xzf", outputPath, "-C", extractDir]);

    // Allowed files should be present
    expect(existsSync(join(extractDir, "settings.json"))).toBe(true);
    expect(existsSync(join(extractDir, "commands", "test.md"))).toBe(true);

    const settings = JSON.parse(await readFile(join(extractDir, "settings.json"), "utf-8"));
    expect(settings.theme).toBe("dark");

    // Denied files should NOT be present
    expect(existsSync(join(extractDir, ".credentials.json"))).toBe(false);

    await rm(extractDir, { recursive: true, force: true });
  });

  it("throws when ~/.claude does not exist", async () => {
    await rm(claudeDir, { recursive: true, force: true });

    const cmd = new ExportCommand(homeDir);
    await expect(cmd.execute({ output: outputPath, quiet: true })).rejects.toThrow(
      "No ~/.claude directory found",
    );
  });

  it("reports nothing to export when all files are denied", async () => {
    // Remove all files except denied ones
    await rm(join(claudeDir, "settings.json"));
    await rm(join(claudeDir, "commands"), { recursive: true, force: true });

    // Update sync filter to deny all remaining
    await writeFile(
      join(claudefyDir, "sync-filter.json"),
      JSON.stringify({
        allowlist: ["settings.json", "commands"],
        denylist: [".credentials.json"],
      }),
    );

    const cmd = new ExportCommand(homeDir);
    // .credentials.json is hardcoded deny; no allowed or unknown items remain
    // but .credentials.json was removed above so nothing remains
    await cmd.execute({ output: outputPath, quiet: true });

    // Archive should not be created since there's nothing to export
    expect(existsSync(outputPath)).toBe(false);
  });

  it("includes unknown files in export", async () => {
    // Add an unknown file (not in allowlist or denylist)
    await writeFile(join(claudeDir, "custom-rules.txt"), "my rules");

    const cmd = new ExportCommand(homeDir);
    await cmd.execute({ output: outputPath, quiet: true });

    const extractDir = await mkdtemp(join(tmpdir(), "claudefy-export-verify-"));
    await execFileAsync("tar", ["-xzf", outputPath, "-C", extractDir]);

    expect(existsSync(join(extractDir, "custom-rules.txt"))).toBe(true);
    const content = await readFile(join(extractDir, "custom-rules.txt"), "utf-8");
    expect(content).toBe("my rules");

    await rm(extractDir, { recursive: true, force: true });
  });

  it("creates parent directories for output path", async () => {
    const nestedOutput = join(homeDir, "nested", "deep", "export.tar.gz");
    const cmd = new ExportCommand(homeDir);
    await cmd.execute({ output: nestedOutput, quiet: true });

    expect(existsSync(nestedOutput)).toBe(true);
  });

  it("expands ~/ in output path", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      const cmd = new ExportCommand(homeDir);
      await cmd.execute({ output: "~/export-test.tar.gz", quiet: true });

      const expandedPath = join(homeDir, "export-test.tar.gz");
      expect(existsSync(expandedPath)).toBe(true);
    } finally {
      if (originalHome !== undefined) {
        process.env.HOME = originalHome;
      } else {
        delete process.env.HOME;
      }
    }
  });
});
