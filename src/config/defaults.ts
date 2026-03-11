import type { SyncFilterConfig } from "./types.js";

export const DEFAULT_SYNC_FILTER: SyncFilterConfig = {
  allowlist: [
    "commands",
    "agents",
    "skills",
    "hooks",
    "rules",
    "plans",
    "plugins",
    "agent-memory",
    "projects",
    "settings.json",
    "history.jsonl",
    "package.json",
  ],
  denylist: [
    "cache",
    "backups",
    "file-history",
    "shell-snapshots",
    "paste-cache",
    "session-env",
    "tasks",
    ".credentials.json",
    "mcp-needs-auth-cache.json",
  ],
};

export const STORE_CONFIG_DIR = "config";
export const STORE_UNKNOWN_DIR = "unknown";
export const STORE_MANIFEST_FILE = "manifest.json";

export const CLAUDEFY_DIR = ".claudefy";
export const CONFIG_FILE = "config.json";
export const LINKS_FILE = "links.json";
export const SYNC_FILTER_FILE = "sync-filter.json";
export const MACHINE_ID_FILE = "machine-id";
