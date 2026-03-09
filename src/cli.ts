import { Command } from "commander";

const program = new Command();

program
  .name("claudefy")
  .description("Sync your Claude Code environment across machines")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize claudefy store on first machine")
  .option("--backend <url>", "Git remote URL for store")
  .option("--create-repo", "Auto-create GitHub/GitLab repo")
  .action(async (options) => {
    console.log("init not yet implemented", options);
  });

program
  .command("join <url>")
  .description("Join existing claudefy store from another machine")
  .action(async (url) => {
    console.log("join not yet implemented", url);
  });

program
  .command("push")
  .description("Push local state to remote store")
  .option("--quiet", "Suppress output (for hooks)")
  .action(async (options) => {
    console.log("push not yet implemented", options);
  });

program
  .command("pull")
  .description("Pull remote state to local machine")
  .option("--quiet", "Suppress output (for hooks)")
  .action(async (options) => {
    console.log("pull not yet implemented", options);
  });

program
  .command("status")
  .description("Show diff between local and remote")
  .action(async () => {
    console.log("status not yet implemented");
  });

program
  .command("override")
  .description("Wipe remote and push local as source of truth")
  .action(async () => {
    console.log("override not yet implemented");
  });

program
  .command("link <alias> [path]")
  .description("Map local path to canonical project ID")
  .action(async (alias, path) => {
    console.log("link not yet implemented", alias, path);
  });

program
  .command("unlink <alias>")
  .description("Remove project mapping")
  .action(async (alias) => {
    console.log("unlink not yet implemented", alias);
  });

program
  .command("links")
  .description("List all project mappings")
  .action(async () => {
    console.log("links not yet implemented");
  });

const configCmd = program
  .command("config")
  .description("Manage claudefy configuration");

configCmd
  .command("set <key> <value>")
  .description("Set a configuration value")
  .action(async (key, value) => {
    console.log("config set not yet implemented", key, value);
  });

configCmd
  .command("get [key]")
  .description("Get configuration values")
  .action(async (key) => {
    console.log("config get not yet implemented", key);
  });

program
  .command("machines")
  .description("List registered machines")
  .action(async () => {
    console.log("machines not yet implemented");
  });

program
  .command("doctor")
  .description("Diagnose sync issues")
  .action(async () => {
    console.log("doctor not yet implemented");
  });

const hooksCmd = program
  .command("hooks")
  .description("Manage auto-sync hooks");

hooksCmd
  .command("install")
  .description("Install auto-sync hooks")
  .action(async () => {
    console.log("hooks install not yet implemented");
  });

hooksCmd
  .command("remove")
  .description("Remove auto-sync hooks")
  .action(async () => {
    console.log("hooks remove not yet implemented");
  });

export { program };
