import { Command } from "commander";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { output } from "./output.js";
import { resolvePassphrase } from "./encryptor/passphrase.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command();
const homeDir = homedir();

async function getGlobalOpts(cmd: Command): Promise<{
  quiet: boolean;
  skipEncryption: boolean;
  skipSecretScan: boolean;
  passphrase?: string;
}> {
  const opts = cmd.optsWithGlobals();
  const quiet = opts.quiet ?? false;
  const skipEncryption = opts.skipEncryption ?? false;
  const skipSecretScan = opts.skipSecretScan ?? false;

  // Resolve passphrase: env var -> OS keychain (only if config exists and opts in)
  let passphrase: string | undefined;
  if (!skipEncryption) {
    let useKeychain = false;
    const configPath = join(homeDir, ".claudefy", "config.json");
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(await readFile(configPath, "utf-8"));
        useKeychain = config.encryption?.useKeychain ?? false;
      } catch {
        // Config unreadable, fall through with useKeychain=false
      }
    }
    const result = await resolvePassphrase(useKeychain);
    if (result) {
      passphrase = result.passphrase;
    }
  }

  return { quiet, skipEncryption, skipSecretScan, passphrase };
}

program
  .name("claudefy")
  .description("Sync your Claude Code environment across machines")
  .version(pkg.version)
  .option("-q, --quiet", "Suppress output")
  .option("--skip-encryption", "Skip encryption")
  .option("--skip-secret-scan", "Skip secret scanning on push");

program
  .command("init")
  .description("Initialize claudefy store on first machine")
  .option("--backend <url>", "Git remote URL for store")
  .option("--create-repo", "Auto-create a GitHub/GitLab repo")
  .option("--hooks", "Install auto-sync hooks")
  .action(async function (this: Command, options) {
    try {
      const global = await getGlobalOpts(this);
      const { InitCommand } = await import("./commands/init.js");
      const cmd = new InitCommand(homeDir);
      await cmd.execute({
        backend: options.backend,
        quiet: global.quiet,
        skipEncryption: global.skipEncryption,
        passphrase: global.passphrase,
        installHooks: options.hooks ?? false,
        createRepo: options.createRepo ?? false,
      });
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("join")
  .description("Join existing claudefy store from another machine")
  .requiredOption("--backend <url>", "Git remote URL for store")
  .option("--hooks", "Install auto-sync hooks")
  .action(async function (this: Command, options) {
    try {
      const global = await getGlobalOpts(this);
      const { JoinCommand } = await import("./commands/join.js");
      const cmd = new JoinCommand(homeDir);
      await cmd.execute({
        backend: options.backend,
        quiet: global.quiet,
        skipEncryption: global.skipEncryption,
        passphrase: global.passphrase,
        installHooks: options.hooks ?? false,
      });
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("push")
  .description("Push local state to remote store")
  .action(async function (this: Command) {
    try {
      const global = await getGlobalOpts(this);
      const { PushCommand } = await import("./commands/push.js");
      const cmd = new PushCommand(homeDir);
      await cmd.execute({
        quiet: global.quiet,
        skipEncryption: global.skipEncryption,
        skipSecretScan: global.skipSecretScan,
        passphrase: global.passphrase,
      });
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("pull")
  .description("Pull remote state to local machine")
  .action(async function (this: Command) {
    try {
      const global = await getGlobalOpts(this);
      const { PullCommand } = await import("./commands/pull.js");
      const cmd = new PullCommand(homeDir);
      await cmd.execute({
        quiet: global.quiet,
        skipEncryption: global.skipEncryption,
        passphrase: global.passphrase,
      });
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("override")
  .description("Wipe remote and push local as source of truth")
  .option("--confirm", "Confirm destructive override")
  .action(async function (this: Command, options) {
    try {
      const global = await getGlobalOpts(this);
      const { OverrideCommand } = await import("./commands/override.js");
      const cmd = new OverrideCommand(homeDir);
      await cmd.execute({
        quiet: global.quiet,
        skipEncryption: global.skipEncryption,
        passphrase: global.passphrase,
        confirm: options.confirm ?? false,
      });
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show diff between local and remote")
  .action(async function (this: Command) {
    try {
      const { StatusCommand } = await import("./commands/status.js");
      const cmd = new StatusCommand(homeDir);
      const result = await cmd.execute();
      console.log(JSON.stringify(result, null, 2));
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("link <alias> <path>")
  .description("Map local path to canonical project ID")
  .action(async (alias, localPath) => {
    try {
      const { LinkCommand } = await import("./commands/link.js");
      const cmd = new LinkCommand(homeDir);
      await cmd.add(alias, localPath);
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("unlink <alias>")
  .description("Remove project mapping")
  .action(async (alias) => {
    try {
      const { LinkCommand } = await import("./commands/link.js");
      const cmd = new LinkCommand(homeDir);
      await cmd.remove(alias);
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("links")
  .description("List all project mappings")
  .action(async () => {
    try {
      const { LinkCommand } = await import("./commands/link.js");
      const cmd = new LinkCommand(homeDir);
      const links = await cmd.list();
      console.log(JSON.stringify(links, null, 2));
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("machines")
  .description("List registered machines")
  .action(async () => {
    try {
      const { MachinesCommand } = await import("./commands/machines.js");
      const cmd = new MachinesCommand(homeDir);
      const machines = await cmd.execute();
      console.log(JSON.stringify(machines, null, 2));
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

const configCmd = program.command("config").description("Manage claudefy configuration");

configCmd
  .command("get [key]")
  .description("Show full config or a specific key")
  .action(async (key?: string) => {
    try {
      const { ConfigCommand } = await import("./commands/config.js");
      const cmd = new ConfigCommand(homeDir);
      const result = await cmd.get(key);
      console.log(typeof result === "object" ? JSON.stringify(result, null, 2) : String(result));
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

configCmd
  .command("set <key> <value>")
  .description("Update a config value")
  .action(async (key: string, value: string) => {
    try {
      const { ConfigCommand } = await import("./commands/config.js");
      const cmd = new ConfigCommand(homeDir);
      await cmd.set(key, value);
      output.success(`Set ${key}`);
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("doctor")
  .description("Diagnose sync health")
  .action(async () => {
    try {
      const { DoctorCommand } = await import("./commands/doctor.js");
      const cmd = new DoctorCommand(homeDir);
      const checks = await cmd.execute();
      for (const check of checks) {
        if (check.status === "pass") {
          output.success(`${check.name}: ${check.detail}`);
        } else if (check.status === "warn") {
          output.warn(`${check.name}: ${check.detail}`);
        } else {
          output.error(`${check.name}: ${check.detail}`);
        }
      }
      const failures = checks.filter((c) => c.status === "fail");
      if (failures.length > 0) {
        process.exit(1);
      }
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

const hooksCmd = program.command("hooks").description("Manage auto-sync hooks");

hooksCmd
  .command("install")
  .description("Install auto-sync hooks")
  .action(async () => {
    try {
      const { HooksCommand } = await import("./commands/hooks.js");
      const cmd = new HooksCommand(homeDir);
      await cmd.install();
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

hooksCmd
  .command("remove")
  .description("Remove auto-sync hooks")
  .action(async () => {
    try {
      const { HooksCommand } = await import("./commands/hooks.js");
      const cmd = new HooksCommand(homeDir);
      await cmd.remove();
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

export { program };
