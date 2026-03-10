#!/usr/bin/env node
import { createRequire } from "node:module";
import { program } from "./cli.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string };

// Check for updates (non-blocking, cached for 1 day)
const updateNotifier = (await import("update-notifier")).default;
updateNotifier({ pkg }).notify();

program.parse();
