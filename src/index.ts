#!/usr/bin/env node
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { program } from "./cli.js";
import type { PackageJson } from "./types.js";
import { CLAUDEFY_DIR } from "./config/defaults.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as PackageJson;

// Non-blocking update check (cached for 1 day).
// Suppressed in quiet mode (-q/--quiet) to avoid unwanted output.
const isQuiet = process.argv.includes("-q") || process.argv.includes("--quiet");

if (process.stdout.isTTY && !isQuiet) {
  import("./update-check.js")
    .then(({ checkForUpdates }) => {
      checkForUpdates(pkg.version, join(homedir(), CLAUDEFY_DIR));
    })
    .catch(() => {}); // Best-effort — update check failure is non-critical
}

program.parse();
