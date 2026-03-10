import { Command } from "commander";
import { homedir } from "node:os";

const program = new Command();
const homeDir = homedir();

function getGlobalOpts(cmd: Command): {
  quiet: boolean;
  skipEncryption: boolean;
  passphrase?: string;
} {
  const opts = cmd.optsWithGlobals();
  return {
    quiet: opts.quiet ?? false,
    skipEncryption: opts.skipEncryption ?? false,
    passphrase: opts.passphrase ?? process.env.CLAUDEFY_PASSPHRASE,
  };
}

program
  .name("claudefy")
  .description("Sync your Claude Code environment across machines")
  .version("0.1.0")
  .option("-q, --quiet", "Suppress output")
  .option("--skip-encryption", "Skip encryption")
  .option("--passphrase <passphrase>", "Encryption passphrase");

program
  .command("init")
  .description("Initialize claudefy store on first machine")
  .requiredOption("--backend <url>", "Git remote URL for store")
  .option("--hooks", "Install auto-sync hooks")
  .action(async function (this: Command, options) {
    try {
      const global = getGlobalOpts(this);
      const { InitCommand } = await import("./commands/init.js");
      const cmd = new InitCommand(homeDir);
      await cmd.execute({
        backend: options.backend,
        quiet: global.quiet,
        skipEncryption: global.skipEncryption,
        passphrase: global.passphrase,
        installHooks: options.hooks ?? false,
      });
    } catch (err: any) {
      console.error(err.message);
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
      const global = getGlobalOpts(this);
      const { JoinCommand } = await import("./commands/join.js");
      const cmd = new JoinCommand(homeDir);
      await cmd.execute({
        backend: options.backend,
        quiet: global.quiet,
        skipEncryption: global.skipEncryption,
        passphrase: global.passphrase,
        installHooks: options.hooks ?? false,
      });
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("push")
  .description("Push local state to remote store")
  .action(async function (this: Command) {
    try {
      const global = getGlobalOpts(this);
      const { PushCommand } = await import("./commands/push.js");
      const cmd = new PushCommand(homeDir);
      await cmd.execute({
        quiet: global.quiet,
        skipEncryption: global.skipEncryption,
        passphrase: global.passphrase,
      });
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("pull")
  .description("Pull remote state to local machine")
  .action(async function (this: Command) {
    try {
      const global = getGlobalOpts(this);
      const { PullCommand } = await import("./commands/pull.js");
      const cmd = new PullCommand(homeDir);
      await cmd.execute({
        quiet: global.quiet,
        skipEncryption: global.skipEncryption,
        passphrase: global.passphrase,
      });
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("override")
  .description("Wipe remote and push local as source of truth")
  .option("--confirm", "Confirm destructive override")
  .action(async function (this: Command, options) {
    try {
      const global = getGlobalOpts(this);
      const { OverrideCommand } = await import("./commands/override.js");
      const cmd = new OverrideCommand(homeDir);
      await cmd.execute({
        quiet: global.quiet,
        skipEncryption: global.skipEncryption,
        passphrase: global.passphrase,
        confirm: options.confirm ?? false,
      });
    } catch (err: any) {
      console.error(err.message);
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
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("link <alias> <path>")
  .description("Map local path to canonical project ID")
  .action(async (_alias, _path) => {
    try {
      const { LinkCommand } = await import("./commands/link.js");
      const cmd = new LinkCommand(homeDir);
      await cmd.add(_alias, _path);
    } catch (err: any) {
      console.error(err.message);
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
    } catch (err: any) {
      console.error(err.message);
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
    } catch (err: any) {
      console.error(err.message);
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
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

const hooksCmd = program
  .command("hooks")
  .description("Manage auto-sync hooks");

hooksCmd
  .command("install")
  .description("Install auto-sync hooks")
  .action(async () => {
    try {
      const { HooksCommand } = await import("./commands/hooks.js");
      const cmd = new HooksCommand(homeDir);
      await cmd.install();
    } catch (err: any) {
      console.error(err.message);
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
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

export { program };
