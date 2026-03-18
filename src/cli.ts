import { Command } from "commander";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import chalk from "chalk";
import { output } from "./output.js";
import { resolvePassphrase } from "./encryptor/passphrase.js";
import { Logger } from "./logger.js";
import type { ReadRecentFilter } from "./logger.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07\x1b]*[\x07\x1b\\]|\x1b[@-_]/g;
function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "");
}

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command();
const homeDir = homedir();
const syncLogger = new Logger(join(homeDir, ".claudefy", "logs", "sync.log"));

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
        skipSecretScan: global.skipSecretScan,
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
  .option("--only <item>", "Sync only this item")
  .option("--force", "Skip pull-before-push")
  .option("--dry-run", "Show what would change without writing")
  .action(async function (this: Command, options) {
    try {
      const global = await getGlobalOpts(this);
      const { PushCommand } = await import("./commands/push.js");
      const cmd = new PushCommand(homeDir);
      await cmd.execute({
        quiet: global.quiet,
        skipEncryption: global.skipEncryption,
        skipSecretScan: global.skipSecretScan,
        passphrase: global.passphrase,
        logger: syncLogger,
        only: options.only,
        force: options.force ?? false,
        dryRun: options.dryRun ?? false,
      });
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("pull")
  .description("Pull remote state to local machine")
  .option("--only <item>", "Sync only this item")
  .option("--dry-run", "Show what would change without writing")
  .action(async function (this: Command, options) {
    try {
      const global = await getGlobalOpts(this);
      const { PullCommand } = await import("./commands/pull.js");
      const cmd = new PullCommand(homeDir);
      await cmd.execute({
        quiet: global.quiet,
        skipEncryption: global.skipEncryption,
        passphrase: global.passphrase,
        logger: syncLogger,
        only: options.only,
        dryRun: options.dryRun ?? false,
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
  .command("diff")
  .description("Preview what push or pull would change")
  .option("--push", "Show only push-direction changes")
  .option("--pull", "Show only pull-direction changes")
  .action(async function (this: Command, options) {
    try {
      const global = await getGlobalOpts(this);
      const { DiffCommand } = await import("./commands/diff.js");
      const cmd = new DiffCommand(homeDir);
      await cmd.execute({
        quiet: global.quiet,
        skipEncryption: global.skipEncryption,
        passphrase: global.passphrase,
        push: options.push ?? false,
        pull: options.pull ?? false,
      });
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

program
  .command("restore")
  .description("Restore ~/.claude from a backup")
  .action(async function (this: Command) {
    try {
      const opts = this.optsWithGlobals();
      const quiet = opts.quiet ?? false;
      const { RestoreCommand } = await import("./commands/restore.js");
      const cmd = new RestoreCommand(homeDir);
      await cmd.executeInteractive({ quiet });
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("completion")
  .description("Output shell completion script")
  .option("--bash", "Output bash completion")
  .option("--zsh", "Output zsh completion")
  .option("--fish", "Output fish completion")
  .action((cmdOpts) => {
    const commands = program.commands.map((c) => c.name()).join(" ");
    const commandList = program.commands.map((c) => c.name());
    if (cmdOpts.fish) {
      const fishCompletions = commandList
        .map((c) => `complete -c claudefy -n '__fish_use_subcommand' -a '${c}'`)
        .join("\n");
      console.log(
        `# claudefy fish completion\n# Save to ~/.config/fish/completions/claudefy.fish\n\n${fishCompletions}`,
      );
    } else if (cmdOpts.zsh) {
      console.log(
        `# claudefy zsh completion\n# Add to your .zshrc:\n# eval "$(claudefy completion --zsh)"\n\n_claudefy() {\n  local commands="${commands}"\n  _arguments '1: :($commands)'\n}\ncompdef _claudefy claudefy`,
      );
    } else {
      console.log(
        `# claudefy bash completion\n# Add to your .bashrc:\n# eval "$(claudefy completion --bash)"\n\n_claudefy() {\n  local commands="${commands}"\n  COMPREPLY=($(compgen -W "$commands" -- "\${COMP_WORDS[COMP_CWORD]}"))\n}\ncomplete -F _claudefy claudefy`,
      );
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
  .command("logs")
  .description("Show recent sync log entries")
  .option("-n, --count <number>", "Number of entries to show", "20")
  .option("--errors", "Show only errors")
  .option("--operation <op>", "Filter by operation (push/pull)")
  .action(async (options) => {
    const filter: ReadRecentFilter = {};
    if (options.errors) filter.level = "error";
    if (options.operation) filter.operation = options.operation;
    const count = parseInt(options.count, 10);
    if (isNaN(count) || count < 1) {
      output.error("--count must be a positive integer");
      return;
    }
    const entries = await syncLogger.readRecent(count, filter);
    if (entries.length === 0) {
      output.dim("No log entries found.");
      return;
    }
    for (const entry of entries) {
      const time = entry.timestamp.replace("T", " ").replace(/\.\d+Z$/, "Z");
      const levelColor =
        entry.level === "error"
          ? chalk.red(entry.level.toUpperCase())
          : entry.level === "warn"
            ? chalk.yellow(entry.level.toUpperCase())
            : chalk.blue(entry.level.toUpperCase());
      console.log(
        `${chalk.dim(time)} ${levelColor} [${entry.operation}] ${stripAnsi(entry.message)}`,
      );
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
  .command("status")
  .description("Check if auto-sync hooks are installed")
  .action(async () => {
    try {
      const { HooksCommand } = await import("./commands/hooks.js");
      const cmd = new HooksCommand(homeDir);
      const installed = await cmd.isInstalled();
      console.log(installed ? "Hooks are installed" : "Hooks are not installed");
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

program
  .command("uninstall")
  .description("Remove claudefy hooks, config, and store")
  .option("--confirm", "Skip confirmation prompt")
  .action(async function (this: Command, options) {
    try {
      const global = await getGlobalOpts(this);
      const { UninstallCommand } = await import("./commands/uninstall.js");
      const cmd = new UninstallCommand(homeDir);
      await cmd.execute({ quiet: global.quiet, confirm: options.confirm });
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("export")
  .description("Create a portable backup archive")
  .requiredOption("-o, --output <path>", "Output file path (e.g., ~/claude-backup.tar.gz)")
  .action(async function (this: Command, options) {
    try {
      const global = await getGlobalOpts(this);
      const { ExportCommand } = await import("./commands/export.js");
      const cmd = new ExportCommand(homeDir);
      await cmd.execute({ quiet: global.quiet, output: options.output });
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("rotate-passphrase")
  .description("Re-encrypt all files with a new passphrase")
  .action(async function (this: Command) {
    try {
      const global = await getGlobalOpts(this);
      const { RotatePassphraseCommand } = await import("./commands/rotate-passphrase.js");
      const cmd = new RotatePassphraseCommand(homeDir);
      await cmd.execute({
        quiet: global.quiet,
        oldPassphrase: global.passphrase,
      });
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

export { program };
