#!/usr/bin/env node
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { program } from "./cli.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string };

// Non-blocking update check (cached for 1 day)
const isQuiet = process.argv.includes("-q") || process.argv.includes("--quiet");

if (process.stdout.isTTY && !isQuiet) {
  import("./update-check.js")
    .then(({ checkForUpdates }) => {
      checkForUpdates(pkg.version, join(homedir(), ".claudefy"));
    })
    .catch(() => {});
}

program.parse();
