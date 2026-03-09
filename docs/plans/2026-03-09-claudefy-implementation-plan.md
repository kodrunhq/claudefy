# claudefy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a CLI tool that syncs the entire `~/.claude` directory across machines with path remapping, selective encryption, and session portability.

**Architecture:** Node.js CLI using Commander.js. Git-native storage with LFS for large files. Three-tier sync filter (allowlist/denylist/unknown-encrypted). age encryption with passphrase from env var, keychain, or prompt. Path remapping via canonical project IDs derived from git remotes.

**Tech Stack:** TypeScript, Commander.js, simple-git, age-encryption (rage-wasm), detect-secrets-js, deepmerge, keytar, Vitest

**Design Doc:** `docs/plans/2026-03-09-claudefy-mvp-design.md`

---

## Phase 1: Project Scaffolding & Config Module

### Task 1.1: Initialize TypeScript Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Create: `src/cli.ts`
- Create: `.gitignore` (update existing)

**Step 1: Initialize npm project**

```bash
npm init -y
```

**Step 2: Install core dependencies**

```bash
npm install commander simple-git deepmerge age-encryption keytar
npm install -D typescript vitest @types/node tsx
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

**Step 5: Create src/cli.ts with Commander skeleton**

```typescript
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

program
  .command("config")
  .description("Manage claudefy configuration")
  .command("set <key> <value>")
  .action(async (key, value) => {
    console.log("config set not yet implemented", key, value);
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

program
  .command("hooks")
  .description("Manage auto-sync hooks")
  .addCommand(
    new Command("install")
      .description("Install auto-sync hooks")
      .action(async () => {
        console.log("hooks install not yet implemented");
      })
  )
  .addCommand(
    new Command("remove")
      .description("Remove auto-sync hooks")
      .action(async () => {
        console.log("hooks remove not yet implemented");
      })
  );

export { program };
```

**Step 6: Create src/index.ts**

```typescript
#!/usr/bin/env node
import { program } from "./cli.js";

program.parse();
```

**Step 7: Update package.json with bin and scripts**

Add to `package.json`:
```json
{
  "type": "module",
  "bin": {
    "claudefy": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest",
    "test:run": "vitest run"
  }
}
```

**Step 8: Build and verify CLI skeleton**

```bash
npm run build
node dist/index.js --help
```

Expected: Shows all commands with descriptions.

**Step 9: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/ .gitignore
git commit -m "feat: scaffold TypeScript CLI with Commander.js"
```

---

### Task 1.2: Config Manager Module

**Files:**
- Create: `src/config/config-manager.ts`
- Create: `src/config/types.ts`
- Create: `src/config/defaults.ts`
- Test: `tests/config/config-manager.test.ts`

**Step 1: Write types**

```typescript
// src/config/types.ts

export interface ClaudefyConfig {
  version: number;
  backend: {
    type: "git";
    url: string;
  };
  encryption: {
    enabled: boolean;
    useKeychain: boolean;
    cacheDuration: string; // e.g. "1h"
  };
  sync: {
    lfsThreshold: number; // bytes, files above this use LFS
  };
  filter: Record<string, "allow" | "deny" | "unknown">;
  machineId: string;
}

export interface LinksConfig {
  [alias: string]: {
    localPath: string;
    canonicalId: string;
    gitRemote: string | null;
    detectedAt: string;
  };
}

export interface SyncFilterConfig {
  allowlist: string[];
  denylist: string[];
  // anything not in either list is "unknown" (synced encrypted)
}
```

**Step 2: Write defaults**

```typescript
// src/config/defaults.ts

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

export const CLAUDEFY_DIR = ".claudefy";
export const CONFIG_FILE = "config.json";
export const LINKS_FILE = "links.json";
export const SYNC_FILTER_FILE = "sync-filter.json";
export const MACHINE_ID_FILE = "machine-id";
```

**Step 3: Write failing test**

```typescript
// tests/config/config-manager.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConfigManager } from "../../src/config/config-manager.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ConfigManager", () => {
  let tempDir: string;
  let configManager: ConfigManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-test-"));
    configManager = new ConfigManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("initializes config directory and files", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    const config = await configManager.load();
    expect(config.backend.url).toBe("git@github.com:user/store.git");
    expect(config.backend.type).toBe("git");
    expect(config.machineId).toBeTruthy();
  });

  it("generates a unique machine ID", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    const config = await configManager.load();
    expect(config.machineId).toMatch(/^[a-z0-9-]+$/);
  });

  it("loads existing config", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    const config1 = await configManager.load();
    const config2 = await configManager.load();
    expect(config1.machineId).toBe(config2.machineId);
  });

  it("updates config values", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    await configManager.set("encryption.useKeychain", true);
    const config = await configManager.load();
    expect(config.encryption.useKeychain).toBe(true);
  });

  it("manages links", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    await configManager.addLink("kodrun", "/home/user/projects/kodrun", {
      canonicalId: "github.com--kodrunhq--kodrun",
      gitRemote: "git@github.com:kodrunhq/kodrun.git",
    });
    const links = await configManager.getLinks();
    expect(links.kodrun.localPath).toBe("/home/user/projects/kodrun");
    expect(links.kodrun.canonicalId).toBe("github.com--kodrunhq--kodrun");
  });

  it("removes links", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    await configManager.addLink("kodrun", "/home/user/projects/kodrun", {
      canonicalId: "github.com--kodrunhq--kodrun",
      gitRemote: null,
    });
    await configManager.removeLink("kodrun");
    const links = await configManager.getLinks();
    expect(links.kodrun).toBeUndefined();
  });

  it("manages sync filter overrides", async () => {
    await configManager.initialize("git@github.com:user/store.git");
    await configManager.setFilterOverride("get-shit-done", "allow");
    const filter = await configManager.getSyncFilter();
    expect(filter.allowlist).toContain("get-shit-done");
  });
});
```

**Step 4: Run test to verify it fails**

```bash
npm run test:run -- tests/config/config-manager.test.ts
```

Expected: FAIL — module not found.

**Step 5: Implement ConfigManager**

```typescript
// src/config/config-manager.ts

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { ClaudefyConfig, LinksConfig, SyncFilterConfig } from "./types.js";
import {
  CLAUDEFY_DIR,
  CONFIG_FILE,
  LINKS_FILE,
  SYNC_FILTER_FILE,
  MACHINE_ID_FILE,
  DEFAULT_SYNC_FILTER,
} from "./defaults.js";

export class ConfigManager {
  private baseDir: string;
  private configDir: string;

  constructor(homeDir: string) {
    this.baseDir = homeDir;
    this.configDir = join(homeDir, CLAUDEFY_DIR);
  }

  async initialize(backendUrl: string): Promise<ClaudefyConfig> {
    await mkdir(this.configDir, { recursive: true });
    await mkdir(join(this.configDir, "backups"), { recursive: true });

    const machineId = `${hostname()}-${randomUUID().slice(0, 8)}`.toLowerCase();
    await writeFile(join(this.configDir, MACHINE_ID_FILE), machineId);

    const config: ClaudefyConfig = {
      version: 1,
      backend: { type: "git", url: backendUrl },
      encryption: {
        enabled: true,
        useKeychain: false,
        cacheDuration: "0",
      },
      sync: {
        lfsThreshold: 512 * 1024, // 512KB
      },
      filter: {},
      machineId,
    };

    await this.saveConfig(config);
    await this.saveLinks({});
    await this.saveSyncFilter({ ...DEFAULT_SYNC_FILTER });

    return config;
  }

  async load(): Promise<ClaudefyConfig> {
    const raw = await readFile(join(this.configDir, CONFIG_FILE), "utf-8");
    return JSON.parse(raw);
  }

  async set(key: string, value: unknown): Promise<void> {
    const config = await this.load();
    const parts = key.split(".");
    let obj: Record<string, unknown> = config as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      obj = obj[parts[i]] as Record<string, unknown>;
    }
    obj[parts[parts.length - 1]] = value;
    await this.saveConfig(config);
  }

  async addLink(
    alias: string,
    localPath: string,
    meta: { canonicalId: string; gitRemote: string | null }
  ): Promise<void> {
    const links = await this.getLinks();
    links[alias] = {
      localPath,
      canonicalId: meta.canonicalId,
      gitRemote: meta.gitRemote,
      detectedAt: new Date().toISOString(),
    };
    await this.saveLinks(links);
  }

  async removeLink(alias: string): Promise<void> {
    const links = await this.getLinks();
    delete links[alias];
    await this.saveLinks(links);
  }

  async getLinks(): Promise<LinksConfig> {
    const path = join(this.configDir, LINKS_FILE);
    if (!existsSync(path)) return {};
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw);
  }

  async getSyncFilter(): Promise<SyncFilterConfig> {
    const path = join(this.configDir, SYNC_FILTER_FILE);
    if (!existsSync(path)) return { ...DEFAULT_SYNC_FILTER };
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw);
  }

  async setFilterOverride(name: string, tier: "allow" | "deny"): Promise<void> {
    const filter = await this.getSyncFilter();
    filter.denylist = filter.denylist.filter((d) => d !== name);
    filter.allowlist = filter.allowlist.filter((a) => a !== name);
    if (tier === "allow") {
      filter.allowlist.push(name);
    } else {
      filter.denylist.push(name);
    }
    await this.saveSyncFilter(filter);
  }

  isInitialized(): boolean {
    return existsSync(join(this.configDir, CONFIG_FILE));
  }

  getConfigDir(): string {
    return this.configDir;
  }

  private async saveConfig(config: ClaudefyConfig): Promise<void> {
    await writeFile(
      join(this.configDir, CONFIG_FILE),
      JSON.stringify(config, null, 2)
    );
  }

  private async saveLinks(links: LinksConfig): Promise<void> {
    await writeFile(
      join(this.configDir, LINKS_FILE),
      JSON.stringify(links, null, 2)
    );
  }

  private async saveSyncFilter(filter: SyncFilterConfig): Promise<void> {
    await writeFile(
      join(this.configDir, SYNC_FILTER_FILE),
      JSON.stringify(filter, null, 2)
    );
  }
}
```

**Step 6: Run tests**

```bash
npm run test:run -- tests/config/config-manager.test.ts
```

Expected: All PASS.

**Step 7: Commit**

```bash
git add src/config/ tests/config/
git commit -m "feat: add config manager with links and sync filter"
```

---

## Phase 2: Sync Filter Module

### Task 2.1: Sync Filter — Classify ~/.claude Contents

**Files:**
- Create: `src/sync-filter/sync-filter.ts`
- Create: `src/sync-filter/types.ts`
- Test: `tests/sync-filter/sync-filter.test.ts`

**Step 1: Write types**

```typescript
// src/sync-filter/types.ts

export type SyncTier = "allow" | "deny" | "unknown";

export interface ClassifiedItem {
  name: string;
  tier: SyncTier;
  isDirectory: boolean;
  sizeBytes: number;
}

export interface ClassificationResult {
  items: ClassifiedItem[];
  allowlist: ClassifiedItem[];
  denylist: ClassifiedItem[];
  unknown: ClassifiedItem[];
}
```

**Step 2: Write failing test**

```typescript
// tests/sync-filter/sync-filter.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SyncFilter } from "../../src/sync-filter/sync-filter.js";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_SYNC_FILTER } from "../../src/config/defaults.js";

describe("SyncFilter", () => {
  let tempDir: string;
  let claudeDir: string;
  let syncFilter: SyncFilter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-filter-test-"));
    claudeDir = join(tempDir, ".claude");
    await mkdir(claudeDir);
    syncFilter = new SyncFilter(DEFAULT_SYNC_FILTER);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("classifies allowlisted directories", async () => {
    await mkdir(join(claudeDir, "commands"));
    await writeFile(join(claudeDir, "commands", "test.md"), "# Test");
    await mkdir(join(claudeDir, "agents"));

    const result = await syncFilter.classify(claudeDir);
    const names = result.allowlist.map((i) => i.name);
    expect(names).toContain("commands");
    expect(names).toContain("agents");
  });

  it("classifies denylisted directories", async () => {
    await mkdir(join(claudeDir, "cache"));
    await mkdir(join(claudeDir, "backups"));

    const result = await syncFilter.classify(claudeDir);
    const names = result.denylist.map((i) => i.name);
    expect(names).toContain("cache");
    expect(names).toContain("backups");
  });

  it("classifies unknown items as unknown tier", async () => {
    await mkdir(join(claudeDir, "get-shit-done"));
    await writeFile(join(claudeDir, "some-random-file.json"), "{}");

    const result = await syncFilter.classify(claudeDir);
    const names = result.unknown.map((i) => i.name);
    expect(names).toContain("get-shit-done");
    expect(names).toContain("some-random-file.json");
  });

  it("classifies allowlisted files", async () => {
    await writeFile(join(claudeDir, "settings.json"), "{}");
    await writeFile(join(claudeDir, "history.jsonl"), "");

    const result = await syncFilter.classify(claudeDir);
    const names = result.allowlist.map((i) => i.name);
    expect(names).toContain("settings.json");
    expect(names).toContain("history.jsonl");
  });

  it("classifies denylisted files", async () => {
    await writeFile(join(claudeDir, ".credentials.json"), "{}");

    const result = await syncFilter.classify(claudeDir);
    const names = result.denylist.map((i) => i.name);
    expect(names).toContain(".credentials.json");
  });

  it("respects filter overrides", async () => {
    await mkdir(join(claudeDir, "get-shit-done"));

    const customFilter = {
      ...DEFAULT_SYNC_FILTER,
      allowlist: [...DEFAULT_SYNC_FILTER.allowlist, "get-shit-done"],
    };
    const filter = new SyncFilter(customFilter);
    const result = await filter.classify(claudeDir);
    const names = result.allowlist.map((i) => i.name);
    expect(names).toContain("get-shit-done");
  });
});
```

**Step 3: Run test to verify it fails**

```bash
npm run test:run -- tests/sync-filter/sync-filter.test.ts
```

Expected: FAIL — module not found.

**Step 4: Implement SyncFilter**

```typescript
// src/sync-filter/sync-filter.ts

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SyncFilterConfig } from "../config/types.js";
import type {
  SyncTier,
  ClassifiedItem,
  ClassificationResult,
} from "./types.js";

export class SyncFilter {
  private config: SyncFilterConfig;

  constructor(config: SyncFilterConfig) {
    this.config = config;
  }

  async classify(claudeDir: string): Promise<ClassificationResult> {
    const entries = await readdir(claudeDir, { withFileTypes: true });
    const items: ClassifiedItem[] = [];

    for (const entry of entries) {
      const tier = this.getTier(entry.name);
      const fullPath = join(claudeDir, entry.name);
      const stats = await stat(fullPath);

      items.push({
        name: entry.name,
        tier,
        isDirectory: entry.isDirectory(),
        sizeBytes: stats.size,
      });
    }

    return {
      items,
      allowlist: items.filter((i) => i.tier === "allow"),
      denylist: items.filter((i) => i.tier === "deny"),
      unknown: items.filter((i) => i.tier === "unknown"),
    };
  }

  getTier(name: string): SyncTier {
    if (this.config.allowlist.includes(name)) return "allow";
    if (this.config.denylist.includes(name)) return "deny";
    return "unknown";
  }
}
```

**Step 5: Run tests**

```bash
npm run test:run -- tests/sync-filter/sync-filter.test.ts
```

Expected: All PASS.

**Step 6: Commit**

```bash
git add src/sync-filter/ tests/sync-filter/
git commit -m "feat: add sync filter with three-tier classification"
```

---

## Phase 3: Path Mapper Module

### Task 3.1: Git Remote Detection

**Files:**
- Create: `src/path-mapper/git-identity.ts`
- Test: `tests/path-mapper/git-identity.test.ts`

**Step 1: Write failing test**

```typescript
// tests/path-mapper/git-identity.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GitIdentity } from "../../src/path-mapper/git-identity.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";

describe("GitIdentity", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-git-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects git remote and derives canonical ID", async () => {
    const git = simpleGit(tempDir);
    await git.init();
    await git.addRemote("origin", "git@github.com:kodrunhq/kodrun.git");

    const identity = new GitIdentity();
    const result = await identity.detect(tempDir);
    expect(result).not.toBeNull();
    expect(result!.canonicalId).toBe("github.com--kodrunhq--kodrun");
    expect(result!.gitRemote).toBe("git@github.com:kodrunhq/kodrun.git");
  });

  it("handles HTTPS remote URLs", async () => {
    const git = simpleGit(tempDir);
    await git.init();
    await git.addRemote("origin", "https://github.com/kodrunhq/kodrun.git");

    const identity = new GitIdentity();
    const result = await identity.detect(tempDir);
    expect(result!.canonicalId).toBe("github.com--kodrunhq--kodrun");
  });

  it("returns null for non-git directories", async () => {
    const identity = new GitIdentity();
    const result = await identity.detect(tempDir);
    expect(result).toBeNull();
  });

  it("returns null for repos without remotes", async () => {
    const git = simpleGit(tempDir);
    await git.init();

    const identity = new GitIdentity();
    const result = await identity.detect(tempDir);
    expect(result).toBeNull();
  });

  it("normalizes canonical ID (strips .git suffix, lowercases)", async () => {
    const git = simpleGit(tempDir);
    await git.init();
    await git.addRemote("origin", "git@GitHub.com:KodrunHQ/Kodrun.GIT");

    const identity = new GitIdentity();
    const result = await identity.detect(tempDir);
    expect(result!.canonicalId).toBe("github.com--kodrunhq--kodrun");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test:run -- tests/path-mapper/git-identity.test.ts
```

**Step 3: Implement GitIdentity**

```typescript
// src/path-mapper/git-identity.ts

import simpleGit from "simple-git";

export interface GitIdentityResult {
  canonicalId: string;
  gitRemote: string;
}

export class GitIdentity {
  async detect(dirPath: string): Promise<GitIdentityResult | null> {
    try {
      const git = simpleGit(dirPath);
      const isRepo = await git.checkIsRepo();
      if (!isRepo) return null;

      const remotes = await git.getRemotes(true);
      const origin = remotes.find((r) => r.name === "origin");
      if (!origin?.refs?.fetch) return null;

      const remoteUrl = origin.refs.fetch;
      const canonicalId = this.urlToCanonicalId(remoteUrl);

      return { canonicalId, gitRemote: remoteUrl };
    } catch {
      return null;
    }
  }

  urlToCanonicalId(url: string): string {
    let normalized = url.toLowerCase();

    // Remove .git suffix
    normalized = normalized.replace(/\.git$/, "");

    // Handle SSH: git@github.com:user/repo
    const sshMatch = normalized.match(/^git@([^:]+):(.+)$/);
    if (sshMatch) {
      return `${sshMatch[1]}--${sshMatch[2].replace(/\//g, "--")}`;
    }

    // Handle HTTPS: https://github.com/user/repo
    const httpsMatch = normalized.match(/^https?:\/\/([^/]+)\/(.+)$/);
    if (httpsMatch) {
      return `${httpsMatch[1]}--${httpsMatch[2].replace(/\//g, "--")}`;
    }

    // Fallback: use URL as-is with slashes replaced
    return normalized.replace(/[/:@]/g, "--");
  }
}
```

**Step 4: Run tests**

```bash
npm run test:run -- tests/path-mapper/git-identity.test.ts
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add src/path-mapper/ tests/path-mapper/
git commit -m "feat: add git remote detection for canonical project IDs"
```

---

### Task 3.2: Path Mapper — Normalize and Remap

**Files:**
- Create: `src/path-mapper/path-mapper.ts`
- Test: `tests/path-mapper/path-mapper.test.ts`

**Step 1: Write failing test**

```typescript
// tests/path-mapper/path-mapper.test.ts

import { describe, it, expect } from "vitest";
import { PathMapper } from "../../src/path-mapper/path-mapper.js";
import type { LinksConfig } from "../../src/config/types.js";

describe("PathMapper", () => {
  const links: LinksConfig = {
    kodrun: {
      localPath: "/home/joseibanez/develop/projects/kodrun",
      canonicalId: "github.com--kodrunhq--kodrun",
      gitRemote: "git@github.com:kodrunhq/kodrun.git",
      detectedAt: "2026-03-09T14:00:00Z",
    },
    claudefy: {
      localPath: "/home/joseibanez/develop/projects/claudefy",
      canonicalId: "github.com--kodrunhq--claudefy",
      gitRemote: "git@github.com:kodrunhq/claudefy.git",
      detectedAt: "2026-03-09T14:00:00Z",
    },
  };

  const mapper = new PathMapper(links);

  describe("project directory names", () => {
    it("normalizes directory name to canonical ID on push", () => {
      const result = mapper.normalizeDirName(
        "-home-joseibanez-develop-projects-kodrun"
      );
      expect(result).toBe("github.com--kodrunhq--kodrun");
    });

    it("remaps canonical ID back to local dir name on pull", () => {
      const result = mapper.remapDirName("github.com--kodrunhq--kodrun");
      expect(result).toBe("-home-joseibanez-develop-projects-kodrun");
    });

    it("returns null for unlinked directories on push", () => {
      const result = mapper.normalizeDirName("-home-user-random-project");
      expect(result).toBeNull();
    });

    it("returns null for unlinked canonical IDs on pull", () => {
      const result = mapper.remapDirName("github.com--unknown--repo");
      expect(result).toBeNull();
    });
  });

  describe("history.jsonl path fields", () => {
    it("normalizes project field on push", () => {
      const line = JSON.stringify({
        display: "test",
        project: "/home/joseibanez/develop/projects/kodrun",
        timestamp: 123,
      });
      const result = mapper.normalizeJsonlLine(line);
      const parsed = JSON.parse(result);
      expect(parsed.project).toBe("@@kodrun@@");
    });

    it("remaps project field on pull", () => {
      const line = JSON.stringify({
        display: "test",
        project: "@@kodrun@@",
        timestamp: 123,
      });
      const result = mapper.remapJsonlLine(line);
      const parsed = JSON.parse(result);
      expect(parsed.project).toBe(
        "/home/joseibanez/develop/projects/kodrun"
      );
    });

    it("normalizes cwd field on push", () => {
      const line = JSON.stringify({
        cwd: "/home/joseibanez/develop/projects/kodrun",
        type: "user",
      });
      const result = mapper.normalizeJsonlLine(line);
      const parsed = JSON.parse(result);
      expect(parsed.cwd).toBe("@@kodrun@@");
    });

    it("leaves unlinked paths unchanged", () => {
      const line = JSON.stringify({
        project: "/home/user/unknown-project",
        timestamp: 123,
      });
      const result = mapper.normalizeJsonlLine(line);
      const parsed = JSON.parse(result);
      expect(parsed.project).toBe("/home/user/unknown-project");
    });
  });

  describe("settings.json path remapping", () => {
    it("normalizes absolute paths in hook commands on push", () => {
      const settings = {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    'node "/home/joseibanez/.claude/hooks/gsd-check-update.js"',
                },
              ],
            },
          ],
        },
      };
      const claudeDir = "/home/joseibanez/.claude";
      const result = mapper.normalizeSettingsPaths(settings, claudeDir);
      expect(result.hooks.SessionStart[0].hooks[0].command).toBe(
        'node "@@CLAUDE_DIR@@/hooks/gsd-check-update.js"'
      );
    });

    it("remaps @@CLAUDE_DIR@@ back to local path on pull", () => {
      const settings = {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    'node "@@CLAUDE_DIR@@/hooks/gsd-check-update.js"',
                },
              ],
            },
          ],
        },
      };
      const claudeDir = "/Users/jose/.claude";
      const result = mapper.remapSettingsPaths(settings, claudeDir);
      expect(result.hooks.SessionStart[0].hooks[0].command).toBe(
        'node "/Users/jose/.claude/hooks/gsd-check-update.js"'
      );
    });
  });

  describe("installed_plugins.json path remapping", () => {
    it("normalizes installPath on push", () => {
      const plugins = {
        version: 2,
        plugins: {
          "github@claude-plugins-official": [
            {
              scope: "user",
              installPath:
                "/home/joseibanez/.claude/plugins/cache/claude-plugins-official/github/205b6e0b3036",
              version: "205b6e0b3036",
            },
          ],
        },
      };
      const claudeDir = "/home/joseibanez/.claude";
      const result = mapper.normalizePluginPaths(plugins, claudeDir);
      expect(
        result.plugins["github@claude-plugins-official"][0].installPath
      ).toBe(
        "@@CLAUDE_DIR@@/plugins/cache/claude-plugins-official/github/205b6e0b3036"
      );
    });

    it("remaps installPath on pull", () => {
      const plugins = {
        version: 2,
        plugins: {
          "github@claude-plugins-official": [
            {
              scope: "user",
              installPath:
                "@@CLAUDE_DIR@@/plugins/cache/claude-plugins-official/github/205b6e0b3036",
              version: "205b6e0b3036",
            },
          ],
        },
      };
      const claudeDir = "/Users/jose/.claude";
      const result = mapper.remapPluginPaths(plugins, claudeDir);
      expect(
        result.plugins["github@claude-plugins-official"][0].installPath
      ).toBe(
        "/Users/jose/.claude/plugins/cache/claude-plugins-official/github/205b6e0b3036"
      );
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test:run -- tests/path-mapper/path-mapper.test.ts
```

**Step 3: Implement PathMapper**

```typescript
// src/path-mapper/path-mapper.ts

import type { LinksConfig } from "../config/types.js";

const CLAUDE_DIR_SENTINEL = "@@CLAUDE_DIR@@";

export class PathMapper {
  private links: LinksConfig;
  private pathToAlias: Map<string, string>;
  private canonicalToAlias: Map<string, string>;

  constructor(links: LinksConfig) {
    this.links = links;
    this.pathToAlias = new Map();
    this.canonicalToAlias = new Map();

    for (const [alias, info] of Object.entries(links)) {
      this.pathToAlias.set(info.localPath, alias);
      this.canonicalToAlias.set(info.canonicalId, alias);
    }
  }

  // --- Directory name remapping (projects/) ---

  normalizeDirName(dirName: string): string | null {
    // Convert dir name back to path: -home-user-project -> /home/user/project
    const path = dirName.replace(/^-/, "/").replace(/-/g, "/");

    for (const [alias, info] of Object.entries(this.links)) {
      if (path === info.localPath) {
        return info.canonicalId;
      }
    }
    return null;
  }

  remapDirName(canonicalId: string): string | null {
    const alias = this.canonicalToAlias.get(canonicalId);
    if (!alias) return null;
    const localPath = this.links[alias].localPath;
    // Convert path to dir name: /home/user/project -> -home-user-project
    return localPath.replace(/\//g, "-").replace(/^-/, "-");
  }

  // --- JSONL line remapping (history.jsonl, session files) ---

  normalizeJsonlLine(line: string): string {
    const obj = JSON.parse(line);
    if (obj.project) {
      obj.project = this.normalizePathField(obj.project);
    }
    if (obj.cwd) {
      obj.cwd = this.normalizePathField(obj.cwd);
    }
    return JSON.stringify(obj);
  }

  remapJsonlLine(line: string): string {
    const obj = JSON.parse(line);
    if (obj.project) {
      obj.project = this.remapPathField(obj.project);
    }
    if (obj.cwd) {
      obj.cwd = this.remapPathField(obj.cwd);
    }
    return JSON.stringify(obj);
  }

  // --- settings.json path remapping ---

  normalizeSettingsPaths(settings: any, claudeDir: string): any {
    const json = JSON.stringify(settings);
    const normalized = json.replaceAll(claudeDir, CLAUDE_DIR_SENTINEL);
    return JSON.parse(normalized);
  }

  remapSettingsPaths(settings: any, claudeDir: string): any {
    const json = JSON.stringify(settings);
    const remapped = json.replaceAll(CLAUDE_DIR_SENTINEL, claudeDir);
    return JSON.parse(remapped);
  }

  // --- installed_plugins.json path remapping ---

  normalizePluginPaths(plugins: any, claudeDir: string): any {
    const json = JSON.stringify(plugins);
    const normalized = json.replaceAll(claudeDir, CLAUDE_DIR_SENTINEL);
    return JSON.parse(normalized);
  }

  remapPluginPaths(plugins: any, claudeDir: string): any {
    const json = JSON.stringify(plugins);
    const remapped = json.replaceAll(CLAUDE_DIR_SENTINEL, claudeDir);
    return JSON.parse(remapped);
  }

  // --- Private helpers ---

  private normalizePathField(value: string): string {
    for (const [alias, info] of Object.entries(this.links)) {
      if (value === info.localPath || value.startsWith(info.localPath + "/")) {
        return `@@${alias}@@${value.slice(info.localPath.length)}`;
      }
    }
    return value;
  }

  private remapPathField(value: string): string {
    const match = value.match(/^@@([^@]+)@@(.*)$/);
    if (!match) return value;
    const alias = match[1];
    const suffix = match[2];
    const info = this.links[alias];
    if (!info) return value;
    return info.localPath + suffix;
  }
}
```

**Step 4: Run tests**

```bash
npm run test:run -- tests/path-mapper/path-mapper.test.ts
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add src/path-mapper/ tests/path-mapper/
git commit -m "feat: add path mapper for directory names, JSONL fields, and settings paths"
```

---

## Phase 4: Encryptor Module

### Task 4.1: age Encryption/Decryption

**Files:**
- Create: `src/encryptor/encryptor.ts`
- Create: `src/encryptor/passphrase.ts`
- Test: `tests/encryptor/encryptor.test.ts`

**Step 1: Write failing test**

```typescript
// tests/encryptor/encryptor.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Encryptor } from "../../src/encryptor/encryptor.js";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Encryptor", () => {
  let tempDir: string;
  const passphrase = "test-passphrase-123";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-enc-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("encrypts and decrypts a file", async () => {
    const encryptor = new Encryptor(passphrase);
    const srcPath = join(tempDir, "test.json");
    const encPath = join(tempDir, "test.json.age");
    const decPath = join(tempDir, "test-dec.json");

    await writeFile(srcPath, '{"key": "secret-value"}');

    await encryptor.encryptFile(srcPath, encPath);
    const encrypted = await readFile(encPath);
    expect(encrypted.toString()).not.toContain("secret-value");

    await encryptor.decryptFile(encPath, decPath);
    const decrypted = await readFile(decPath, "utf-8");
    expect(decrypted).toBe('{"key": "secret-value"}');
  });

  it("encrypts and decrypts a string", async () => {
    const encryptor = new Encryptor(passphrase);
    const original = "sensitive data here";

    const encrypted = await encryptor.encryptString(original);
    expect(encrypted).not.toContain("sensitive");

    const decrypted = await encryptor.decryptString(encrypted);
    expect(decrypted).toBe(original);
  });

  it("fails decryption with wrong passphrase", async () => {
    const encryptor1 = new Encryptor("correct-passphrase");
    const encryptor2 = new Encryptor("wrong-passphrase");

    const encrypted = await encryptor1.encryptString("secret");
    await expect(encryptor2.decryptString(encrypted)).rejects.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test:run -- tests/encryptor/encryptor.test.ts
```

**Step 3: Implement Encryptor**

Note: The `age-encryption` npm package provides the rage-wasm bindings. If unavailable at implementation time, fall back to spawning `age` CLI binary via child_process. The interface stays the same.

```typescript
// src/encryptor/encryptor.ts

import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";

const execFileAsync = promisify(execFile);

export class Encryptor {
  private passphrase: string;

  constructor(passphrase: string) {
    this.passphrase = passphrase;
  }

  async encryptFile(inputPath: string, outputPath: string): Promise<void> {
    const content = await readFile(inputPath);
    const encrypted = await this.encryptBuffer(content);
    await writeFile(outputPath, encrypted);
  }

  async decryptFile(inputPath: string, outputPath: string): Promise<void> {
    const content = await readFile(inputPath);
    const decrypted = await this.decryptBuffer(content);
    await writeFile(outputPath, decrypted);
  }

  async encryptString(input: string): Promise<string> {
    const encrypted = await this.encryptBuffer(Buffer.from(input, "utf-8"));
    return encrypted.toString("base64");
  }

  async decryptString(input: string): Promise<string> {
    const buffer = Buffer.from(input, "base64");
    const decrypted = await this.decryptBuffer(buffer);
    return decrypted.toString("utf-8");
  }

  private async encryptBuffer(input: Buffer): Promise<Buffer> {
    // Use age CLI with passphrase via stdin
    return new Promise((resolve, reject) => {
      const child = execFile(
        "age",
        ["-p", "-o", "-"],
        { encoding: "buffer", maxBuffer: 50 * 1024 * 1024 },
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        }
      );
      // Send passphrase + confirmation + data
      child.stdin!.write(this.passphrase + "\n");
      child.stdin!.write(this.passphrase + "\n");
      child.stdin!.write(input);
      child.stdin!.end();
    });
  }

  private async decryptBuffer(input: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        "age",
        ["-d"],
        { encoding: "buffer", maxBuffer: 50 * 1024 * 1024 },
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        }
      );
      child.stdin!.write(this.passphrase + "\n");
      child.stdin!.write(input);
      child.stdin!.end();
    });
  }
}
```

> **Implementation note:** The exact age CLI invocation may need adjustment. If `rage-wasm` npm package is stable at implementation time, prefer that over CLI spawning. The tests define the contract — implementation can swap backends freely.

**Step 4: Implement passphrase resolution**

```typescript
// src/encryptor/passphrase.ts

import { env } from "node:process";

export type PassphraseSource = "env" | "keychain" | "prompt" | "none";

export interface PassphraseResult {
  passphrase: string;
  source: PassphraseSource;
}

export async function resolvePassphrase(
  useKeychain: boolean
): Promise<PassphraseResult | null> {
  // 1. Environment variable
  const envPassphrase = env.CLAUDEFY_PASSPHRASE;
  if (envPassphrase) {
    return { passphrase: envPassphrase, source: "env" };
  }

  // 2. OS Keychain (if enabled)
  if (useKeychain) {
    try {
      const keytar = await import("keytar");
      const stored = await keytar.getPassword("claudefy", "passphrase");
      if (stored) {
        return { passphrase: stored, source: "keychain" };
      }
    } catch {
      // keytar not available, fall through
    }
  }

  // 3. Return null — caller decides whether to prompt or skip
  return null;
}

export async function storePassphraseInKeychain(
  passphrase: string
): Promise<boolean> {
  try {
    const keytar = await import("keytar");
    await keytar.setPassword("claudefy", "passphrase", passphrase);
    return true;
  } catch {
    return false;
  }
}
```

**Step 5: Run tests**

```bash
npm run test:run -- tests/encryptor/encryptor.test.ts
```

Expected: All PASS (requires `age` CLI installed).

**Step 6: Commit**

```bash
git add src/encryptor/ tests/encryptor/
git commit -m "feat: add age encryption with passphrase resolution chain"
```

---

## Phase 5: Secret Scanner Module

### Task 5.1: Pre-Push Secret Detection

**Files:**
- Create: `src/secret-scanner/scanner.ts`
- Test: `tests/secret-scanner/scanner.test.ts`

**Step 1: Install dependency**

```bash
npm install detect-secrets-js
```

> **Implementation note:** If `detect-secrets-js` is not available or has API issues at implementation time, check npm for alternatives (`@bytehide/secrets-scanner`, `detect-secrets`). The interface below should remain the same.

**Step 2: Write failing test**

```typescript
// tests/secret-scanner/scanner.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SecretScanner } from "../../src/secret-scanner/scanner.js";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("SecretScanner", () => {
  let tempDir: string;
  let scanner: SecretScanner;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-scan-test-"));
    scanner = new SecretScanner();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects API keys in files", async () => {
    const file = join(tempDir, "settings.json");
    await writeFile(
      file,
      JSON.stringify({ apiKey: "sk-ant-api03-reallyLongSecretKeyHere1234567890abcdef" })
    );

    const results = await scanner.scanFile(file);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBe(file);
  });

  it("detects AWS credentials", async () => {
    const file = join(tempDir, "config.json");
    await writeFile(file, JSON.stringify({ key: "AKIAIOSFODNN7EXAMPLE" }));

    const results = await scanner.scanFile(file);
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns empty for clean files", async () => {
    const file = join(tempDir, "commands.md");
    await writeFile(file, "# My Command\nDo something useful");

    const results = await scanner.scanFile(file);
    expect(results.length).toBe(0);
  });

  it("scans multiple files", async () => {
    const clean = join(tempDir, "clean.md");
    const dirty = join(tempDir, "dirty.json");
    await writeFile(clean, "no secrets here");
    await writeFile(
      dirty,
      JSON.stringify({ token: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef12" })
    );

    const results = await scanner.scanFiles([clean, dirty]);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.file === dirty)).toBe(true);
  });
});
```

**Step 3: Run test to verify it fails**

```bash
npm run test:run -- tests/secret-scanner/scanner.test.ts
```

**Step 4: Implement SecretScanner**

```typescript
// src/secret-scanner/scanner.ts

import { readFile } from "node:fs/promises";

export interface SecretFinding {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
}

// Patterns for common secrets
const SECRET_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "Anthropic API Key", regex: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { name: "OpenAI API Key", regex: /sk-[a-zA-Z0-9]{20,}/ },
  { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/ },
  { name: "GitHub Token", regex: /ghp_[A-Za-z0-9]{36}/ },
  { name: "GitHub OAuth", regex: /gho_[A-Za-z0-9]{36}/ },
  { name: "GitLab Token", regex: /glpat-[A-Za-z0-9\-_]{20,}/ },
  { name: "Generic Bearer", regex: /Bearer\s+[a-zA-Z0-9_\-.]{20,}/ },
  { name: "Generic Secret Key", regex: /"(?:secret|password|token|apiKey|api_key|private_key)"\s*:\s*"[^"]{8,}"/ },
  { name: "High Entropy Base64", regex: /[A-Za-z0-9+/]{40,}={0,2}/ },
];

export class SecretScanner {
  async scanFile(filePath: string): Promise<SecretFinding[]> {
    const content = await readFile(filePath, "utf-8");
    const findings: SecretFinding[] = [];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.regex.test(lines[i])) {
          findings.push({
            file: filePath,
            line: i + 1,
            pattern: pattern.name,
            snippet: lines[i].slice(0, 80),
          });
        }
      }
    }

    return findings;
  }

  async scanFiles(filePaths: string[]): Promise<SecretFinding[]> {
    const results: SecretFinding[] = [];
    for (const filePath of filePaths) {
      const findings = await this.scanFile(filePath);
      results.push(...findings);
    }
    return results;
  }
}
```

> **Implementation note:** Start with built-in patterns. If `detect-secrets-js` works well at implementation time, replace the regex list with its scanner. The test contract stays the same either way.

**Step 5: Run tests**

```bash
npm run test:run -- tests/secret-scanner/scanner.test.ts
```

Expected: All PASS.

**Step 6: Commit**

```bash
git add src/secret-scanner/ tests/secret-scanner/
git commit -m "feat: add pre-push secret scanner with common patterns"
```

---

## Phase 6: Git Adapter Module

### Task 6.1: Git Store Operations

**Files:**
- Create: `src/git-adapter/git-adapter.ts`
- Create: `src/git-adapter/types.ts`
- Test: `tests/git-adapter/git-adapter.test.ts`

**Step 1: Write types**

```typescript
// src/git-adapter/types.ts

export interface StoreStatus {
  isClean: boolean;
  ahead: number;
  behind: number;
  modified: string[];
  added: string[];
  deleted: string[];
}

export interface SyncMetadata {
  machineId: string;
  hostname: string;
  os: string;
  lastSync: string;
}
```

**Step 2: Write failing test**

```typescript
// tests/git-adapter/git-adapter.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GitAdapter } from "../../src/git-adapter/git-adapter.js";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";

describe("GitAdapter", () => {
  let remoteDir: string;
  let localDir: string;

  beforeEach(async () => {
    // Create a bare repo as "remote"
    remoteDir = await mkdtemp(join(tmpdir(), "claudefy-remote-"));
    const bareGit = simpleGit(remoteDir);
    await bareGit.init(true);

    localDir = await mkdtemp(join(tmpdir(), "claudefy-local-"));
  });

  afterEach(async () => {
    await rm(remoteDir, { recursive: true, force: true });
    await rm(localDir, { recursive: true, force: true });
  });

  it("initializes a store by cloning", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    const git = simpleGit(join(localDir, "store"));
    const isRepo = await git.checkIsRepo();
    expect(isRepo).toBe(true);
  });

  it("writes files and pushes", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    const storePath = adapter.getStorePath();
    await mkdir(join(storePath, "config", "commands"), { recursive: true });
    await writeFile(
      join(storePath, "config", "commands", "test.md"),
      "# Test"
    );

    await adapter.commitAndPush("test: add command");

    // Verify by cloning in another location
    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-verify-"));
    const verifyGit = simpleGit(verifyDir);
    await verifyGit.clone(remoteDir, "store");
    const content = await readFile(
      join(verifyDir, "store", "config", "commands", "test.md"),
      "utf-8"
    );
    expect(content).toBe("# Test");
    await rm(verifyDir, { recursive: true, force: true });
  });

  it("pulls changes from remote", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    // Push something from a second clone
    const otherDir = await mkdtemp(join(tmpdir(), "claudefy-other-"));
    const otherGit = simpleGit(otherDir);
    await otherGit.clone(remoteDir, "store");
    const otherStore = join(otherDir, "store");
    await writeFile(join(otherStore, "test-file.txt"), "from other machine");
    await simpleGit(otherStore).add(".").commit("add test file").push();

    // Pull in original
    await adapter.pull();
    const content = await readFile(
      join(adapter.getStorePath(), "test-file.txt"),
      "utf-8"
    );
    expect(content).toBe("from other machine");

    await rm(otherDir, { recursive: true, force: true });
  });

  it("detects override marker", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    await adapter.writeOverrideMarker("nuc-i7");
    await adapter.commitAndPush("override from nuc-i7");

    // From another clone
    const otherDir = await mkdtemp(join(tmpdir(), "claudefy-other-"));
    const otherAdapter = new GitAdapter(otherDir);
    await otherAdapter.initStore(remoteDir);

    const override = await otherAdapter.checkOverrideMarker();
    expect(override).not.toBeNull();
    expect(override!.machine).toBe("nuc-i7");

    await rm(otherDir, { recursive: true, force: true });
  });

  it("force pushes on override", async () => {
    const adapter = new GitAdapter(localDir);
    await adapter.initStore(remoteDir);

    const storePath = adapter.getStorePath();
    await writeFile(join(storePath, "data.txt"), "original");
    await adapter.commitAndPush("original data");

    // Override: wipe store and push new content
    await adapter.wipeAndPush("override-machine");

    // Verify remote only has override marker
    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-verify-"));
    await simpleGit(verifyDir).clone(remoteDir, "store");
    const override = await readFile(
      join(verifyDir, "store", ".override"),
      "utf-8"
    );
    expect(JSON.parse(override).machine).toBe("override-machine");
    await rm(verifyDir, { recursive: true, force: true });
  });
});
```

**Step 3: Run test to verify it fails**

```bash
npm run test:run -- tests/git-adapter/git-adapter.test.ts
```

**Step 4: Implement GitAdapter**

```typescript
// src/git-adapter/git-adapter.ts

import simpleGit, { SimpleGit } from "simple-git";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface OverrideMarker {
  machine: string;
  timestamp: string;
}

export class GitAdapter {
  private baseDir: string;
  private storePath: string;
  private git: SimpleGit | null = null;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.storePath = join(baseDir, "store");
  }

  async initStore(remoteUrl: string): Promise<void> {
    if (existsSync(this.storePath)) {
      this.git = simpleGit(this.storePath);
      return;
    }

    try {
      await simpleGit(this.baseDir).clone(remoteUrl, "store");
    } catch {
      // Empty bare repo — init locally and set remote
      await mkdir(this.storePath, { recursive: true });
      const git = simpleGit(this.storePath);
      await git.init();
      await git.addRemote("origin", remoteUrl);
      // Create initial commit so we have a branch
      await writeFile(join(this.storePath, ".gitkeep"), "");
      await git.add(".").commit("initial claudefy store");
      await git.push(["-u", "origin", "main"]);
    }

    this.git = simpleGit(this.storePath);
  }

  async commitAndPush(message: string): Promise<void> {
    this.ensureInitialized();
    await this.git!.add(".");
    const status = await this.git!.status();
    if (!status.isClean()) {
      await this.git!.commit(message);
      await this.git!.push();
    }
  }

  async pull(): Promise<void> {
    this.ensureInitialized();
    await this.git!.pull();
  }

  async writeOverrideMarker(machineId: string): Promise<void> {
    const marker: OverrideMarker = {
      machine: machineId,
      timestamp: new Date().toISOString(),
    };
    await writeFile(
      join(this.storePath, ".override"),
      JSON.stringify(marker, null, 2)
    );
  }

  async checkOverrideMarker(): Promise<OverrideMarker | null> {
    const path = join(this.storePath, ".override");
    if (!existsSync(path)) return null;
    const content = await readFile(path, "utf-8");
    return JSON.parse(content);
  }

  async removeOverrideMarker(): Promise<void> {
    const path = join(this.storePath, ".override");
    if (existsSync(path)) {
      await rm(path);
    }
  }

  async wipeAndPush(machineId: string): Promise<void> {
    this.ensureInitialized();
    // Remove all files except .git
    const { readdirSync } = await import("node:fs");
    const entries = readdirSync(this.storePath);
    for (const entry of entries) {
      if (entry === ".git") continue;
      await rm(join(this.storePath, entry), { recursive: true, force: true });
    }
    // Write override marker
    await this.writeOverrideMarker(machineId);
    await this.git!.add(".");
    await this.git!.commit(`override: ${machineId} at ${new Date().toISOString()}`);
    await this.git!.push(["--force"]);
  }

  getStorePath(): string {
    return this.storePath;
  }

  private ensureInitialized(): void {
    if (!this.git) {
      throw new Error("GitAdapter not initialized. Call initStore() first.");
    }
  }
}
```

**Step 5: Run tests**

```bash
npm run test:run -- tests/git-adapter/git-adapter.test.ts
```

Expected: All PASS.

**Step 6: Commit**

```bash
git add src/git-adapter/ tests/git-adapter/
git commit -m "feat: add git adapter with clone, push, pull, and override support"
```

---

## Phase 7: Merger Module

### Task 7.1: JSON Deep Merge for settings.json + LWW

**Files:**
- Create: `src/merger/merger.ts`
- Test: `tests/merger/merger.test.ts`

**Step 1: Write failing test**

```typescript
// tests/merger/merger.test.ts

import { describe, it, expect } from "vitest";
import { Merger } from "../../src/merger/merger.js";

describe("Merger", () => {
  const merger = new Merger();

  describe("deep JSON merge (settings.json)", () => {
    it("merges non-overlapping keys", () => {
      const local = { hooks: { SessionStart: [] }, enabledPlugins: { a: true } };
      const remote = { hooks: { SessionEnd: [] }, enabledPlugins: { b: true } };

      const result = merger.deepMergeJson(local, remote);
      expect(result.hooks.SessionStart).toEqual([]);
      expect(result.hooks.SessionEnd).toEqual([]);
      expect(result.enabledPlugins.a).toBe(true);
      expect(result.enabledPlugins.b).toBe(true);
    });

    it("remote wins on same-key conflict", () => {
      const local = { enabledPlugins: { a: true } };
      const remote = { enabledPlugins: { a: false } };

      const result = merger.deepMergeJson(local, remote);
      expect(result.enabledPlugins.a).toBe(false);
    });

    it("preserves nested structure", () => {
      const local = {
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "local-cmd" }] }],
        },
      };
      const remote = {
        hooks: {
          PostToolUse: [{ hooks: [{ type: "command", command: "remote-cmd" }] }],
        },
      };

      const result = merger.deepMergeJson(local, remote);
      expect(result.hooks.SessionStart).toBeDefined();
      expect(result.hooks.PostToolUse).toBeDefined();
    });
  });

  describe("last-write-wins", () => {
    it("returns remote when remote is newer", () => {
      const result = merger.lastWriteWins(
        { content: "local", mtime: 1000 },
        { content: "remote", mtime: 2000 }
      );
      expect(result).toBe("remote");
    });

    it("returns local when local is newer", () => {
      const result = merger.lastWriteWins(
        { content: "local", mtime: 2000 },
        { content: "remote", mtime: 1000 }
      );
      expect(result).toBe("local");
    });

    it("returns remote on tie", () => {
      const result = merger.lastWriteWins(
        { content: "local", mtime: 1000 },
        { content: "remote", mtime: 1000 }
      );
      expect(result).toBe("remote");
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test:run -- tests/merger/merger.test.ts
```

**Step 3: Implement Merger**

```typescript
// src/merger/merger.ts

import deepmerge from "deepmerge";

export class Merger {
  deepMergeJson(local: Record<string, any>, remote: Record<string, any>): Record<string, any> {
    return deepmerge(local, remote, {
      // Remote wins on array conflicts (replace, don't concatenate)
      arrayMerge: (_target, source) => source,
    });
  }

  lastWriteWins(
    local: { content: string; mtime: number },
    remote: { content: string; mtime: number }
  ): string {
    if (local.mtime > remote.mtime) return local.content;
    return remote.content;
  }
}
```

**Step 4: Run tests**

```bash
npm run test:run -- tests/merger/merger.test.ts
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add src/merger/ tests/merger/
git commit -m "feat: add merger with deep JSON merge and LWW strategies"
```

---

## Phase 8: Backup Manager Module

### Task 8.1: Pre-Destructive Backup

**Files:**
- Create: `src/backup-manager/backup-manager.ts`
- Test: `tests/backup-manager/backup-manager.test.ts`

**Step 1: Write failing test**

```typescript
// tests/backup-manager/backup-manager.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BackupManager } from "../../src/backup-manager/backup-manager.js";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

describe("BackupManager", () => {
  let tempDir: string;
  let claudeDir: string;
  let claudefyDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-backup-test-"));
    claudeDir = join(tempDir, ".claude");
    claudefyDir = join(tempDir, ".claudefy");
    await mkdir(claudeDir);
    await mkdir(claudefyDir);
    await mkdir(join(claudefyDir, "backups"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates a timestamped backup of ~/.claude", async () => {
    await mkdir(join(claudeDir, "commands"));
    await writeFile(join(claudeDir, "commands", "test.md"), "# Test");
    await writeFile(join(claudeDir, "settings.json"), '{"key": "value"}');

    const backupManager = new BackupManager(claudefyDir);
    const backupPath = await backupManager.createBackup(claudeDir, "pre-override");

    expect(existsSync(backupPath)).toBe(true);
    const settings = await readFile(
      join(backupPath, "settings.json"),
      "utf-8"
    );
    expect(settings).toBe('{"key": "value"}');
    const command = await readFile(
      join(backupPath, "commands", "test.md"),
      "utf-8"
    );
    expect(command).toBe("# Test");
  });

  it("lists existing backups", async () => {
    await writeFile(join(claudeDir, "settings.json"), "{}");
    const backupManager = new BackupManager(claudefyDir);

    await backupManager.createBackup(claudeDir, "backup-1");
    await backupManager.createBackup(claudeDir, "backup-2");

    const backups = await backupManager.listBackups();
    expect(backups.length).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test:run -- tests/backup-manager/backup-manager.test.ts
```

**Step 3: Implement BackupManager**

```typescript
// src/backup-manager/backup-manager.ts

import { cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

export class BackupManager {
  private backupsDir: string;

  constructor(claudefyDir: string) {
    this.backupsDir = join(claudefyDir, "backups");
  }

  async createBackup(claudeDir: string, label: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `${timestamp}--${label}`;
    const backupPath = join(this.backupsDir, backupName);

    await mkdir(backupPath, { recursive: true });
    await cp(claudeDir, backupPath, { recursive: true });

    return backupPath;
  }

  async listBackups(): Promise<string[]> {
    try {
      const entries = await readdir(this.backupsDir);
      return entries.sort().reverse();
    } catch {
      return [];
    }
  }
}
```

**Step 4: Run tests**

```bash
npm run test:run -- tests/backup-manager/backup-manager.test.ts
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add src/backup-manager/ tests/backup-manager/
git commit -m "feat: add backup manager for pre-destructive snapshots"
```

---

## Phase 9: Hook Manager Module

### Task 9.1: Install/Remove Claude Code Hooks

**Files:**
- Create: `src/hook-manager/hook-manager.ts`
- Test: `tests/hook-manager/hook-manager.test.ts`

**Step 1: Write failing test**

```typescript
// tests/hook-manager/hook-manager.test.ts

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

    const startCmd = settings.hooks.SessionStart.find((h: any) =>
      h.hooks.some((hk: any) => hk.command.includes("claudefy pull"))
    );
    expect(startCmd).toBeDefined();

    const endCmd = settings.hooks.SessionEnd.find((h: any) =>
      h.hooks.some((hk: any) => hk.command.includes("claudefy push"))
    );
    expect(endCmd).toBeDefined();
  });

  it("installs hooks alongside existing hooks", async () => {
    const existing = {
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "echo existing" }] },
        ],
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
        SessionEnd: [
          { hooks: [{ type: "command", command: "claudefy push --quiet" }] },
        ],
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

  it("detects if hooks are installed", async () => {
    await writeFile(settingsPath, "{}");
    const manager = new HookManager(settingsPath);

    expect(await manager.isInstalled()).toBe(false);

    await manager.install();
    expect(await manager.isInstalled()).toBe(true);

    await manager.remove();
    expect(await manager.isInstalled()).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test:run -- tests/hook-manager/hook-manager.test.ts
```

**Step 3: Implement HookManager**

```typescript
// src/hook-manager/hook-manager.ts

import { readFile, writeFile } from "node:fs/promises";

const CLAUDEFY_MARKER = "claudefy";

export class HookManager {
  private settingsPath: string;

  constructor(settingsPath: string) {
    this.settingsPath = settingsPath;
  }

  async install(): Promise<void> {
    const settings = await this.loadSettings();

    if (!settings.hooks) settings.hooks = {};

    // SessionStart -> pull
    if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
    if (!this.hasClaudefyHook(settings.hooks.SessionStart)) {
      settings.hooks.SessionStart.push({
        hooks: [
          {
            type: "command",
            command: "claudefy pull --quiet",
          },
        ],
      });
    }

    // SessionEnd -> push
    if (!settings.hooks.SessionEnd) settings.hooks.SessionEnd = [];
    if (!this.hasClaudefyHook(settings.hooks.SessionEnd)) {
      settings.hooks.SessionEnd.push({
        hooks: [
          {
            type: "command",
            command: "claudefy push --quiet",
          },
        ],
      });
    }

    await this.saveSettings(settings);
  }

  async remove(): Promise<void> {
    const settings = await this.loadSettings();

    if (settings.hooks) {
      for (const event of Object.keys(settings.hooks)) {
        settings.hooks[event] = settings.hooks[event].filter(
          (h: any) => !this.isClaudefyHookEntry(h)
        );
        if (settings.hooks[event].length === 0) {
          delete settings.hooks[event];
        }
      }
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }
    }

    await this.saveSettings(settings);
  }

  async isInstalled(): Promise<boolean> {
    const settings = await this.loadSettings();
    if (!settings.hooks) return false;

    const startHooks = settings.hooks.SessionStart || [];
    const endHooks = settings.hooks.SessionEnd || [];

    return (
      this.hasClaudefyHook(startHooks) && this.hasClaudefyHook(endHooks)
    );
  }

  private hasClaudefyHook(hookArray: any[]): boolean {
    return hookArray.some((h) => this.isClaudefyHookEntry(h));
  }

  private isClaudefyHookEntry(hookEntry: any): boolean {
    return hookEntry.hooks?.some((h: any) =>
      h.command?.includes(CLAUDEFY_MARKER)
    );
  }

  private async loadSettings(): Promise<any> {
    const content = await readFile(this.settingsPath, "utf-8");
    return JSON.parse(content);
  }

  private async saveSettings(settings: any): Promise<void> {
    await writeFile(this.settingsPath, JSON.stringify(settings, null, 2));
  }
}
```

**Step 4: Run tests**

```bash
npm run test:run -- tests/hook-manager/hook-manager.test.ts
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add src/hook-manager/ tests/hook-manager/
git commit -m "feat: add hook manager for auto-sync Claude Code hooks"
```

---

## Phase 10: Machine Registry Module

### Task 10.1: Track Registered Machines

**Files:**
- Create: `src/machine-registry/machine-registry.ts`
- Test: `tests/machine-registry/machine-registry.test.ts`

**Step 1: Write failing test**

```typescript
// tests/machine-registry/machine-registry.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MachineRegistry } from "../../src/machine-registry/machine-registry.js";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("MachineRegistry", () => {
  let tempDir: string;
  let manifestPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-registry-test-"));
    manifestPath = join(tempDir, "manifest.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("registers a new machine", async () => {
    const registry = new MachineRegistry(manifestPath);
    await registry.register("nuc-i7-abc123", "nuc-i7", "linux");

    const machines = await registry.list();
    expect(machines).toHaveLength(1);
    expect(machines[0].machineId).toBe("nuc-i7-abc123");
    expect(machines[0].hostname).toBe("nuc-i7");
    expect(machines[0].os).toBe("linux");
  });

  it("updates last sync time on existing machine", async () => {
    const registry = new MachineRegistry(manifestPath);
    await registry.register("nuc-i7-abc123", "nuc-i7", "linux");
    const before = (await registry.list())[0].lastSync;

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 10));
    await registry.updateLastSync("nuc-i7-abc123");
    const after = (await registry.list())[0].lastSync;

    expect(after).not.toBe(before);
  });

  it("handles multiple machines", async () => {
    const registry = new MachineRegistry(manifestPath);
    await registry.register("nuc-i7-abc123", "nuc-i7", "linux");
    await registry.register("macbook-def456", "macbook-pro", "darwin");

    const machines = await registry.list();
    expect(machines).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test:run -- tests/machine-registry/machine-registry.test.ts
```

**Step 3: Implement MachineRegistry**

```typescript
// src/machine-registry/machine-registry.ts

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface MachineEntry {
  machineId: string;
  hostname: string;
  os: string;
  lastSync: string;
  registeredAt: string;
}

interface Manifest {
  version: number;
  machines: MachineEntry[];
}

export class MachineRegistry {
  private manifestPath: string;

  constructor(manifestPath: string) {
    this.manifestPath = manifestPath;
  }

  async register(machineId: string, hostname: string, os: string): Promise<void> {
    const manifest = await this.loadManifest();
    const existing = manifest.machines.find((m) => m.machineId === machineId);

    if (existing) {
      existing.hostname = hostname;
      existing.os = os;
      existing.lastSync = new Date().toISOString();
    } else {
      manifest.machines.push({
        machineId,
        hostname,
        os,
        lastSync: new Date().toISOString(),
        registeredAt: new Date().toISOString(),
      });
    }

    await this.saveManifest(manifest);
  }

  async updateLastSync(machineId: string): Promise<void> {
    const manifest = await this.loadManifest();
    const machine = manifest.machines.find((m) => m.machineId === machineId);
    if (machine) {
      machine.lastSync = new Date().toISOString();
      await this.saveManifest(manifest);
    }
  }

  async list(): Promise<MachineEntry[]> {
    const manifest = await this.loadManifest();
    return manifest.machines;
  }

  private async loadManifest(): Promise<Manifest> {
    if (!existsSync(this.manifestPath)) {
      return { version: 1, machines: [] };
    }
    const raw = await readFile(this.manifestPath, "utf-8");
    return JSON.parse(raw);
  }

  private async saveManifest(manifest: Manifest): Promise<void> {
    await writeFile(this.manifestPath, JSON.stringify(manifest, null, 2));
  }
}
```

**Step 4: Run tests**

```bash
npm run test:run -- tests/machine-registry/machine-registry.test.ts
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add src/machine-registry/ tests/machine-registry/
git commit -m "feat: add machine registry for tracking synced machines"
```

---

## Phase 11: Push Command — Full Pipeline

### Task 11.1: Orchestrate Push Flow

This is the main orchestration task. It wires all modules together.

**Files:**
- Create: `src/commands/push.ts`
- Create: `src/commands/helpers/prompt.ts`
- Test: `tests/commands/push.test.ts`

**Step 1: Write failing test**

```typescript
// tests/commands/push.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PushCommand } from "../../src/commands/push.js";
import {
  mkdtemp, rm, mkdir, writeFile, readFile, readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";

describe("PushCommand", () => {
  let homeDir: string;
  let claudeDir: string;
  let claudefyDir: string;
  let remoteDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-push-test-"));
    claudeDir = join(homeDir, ".claude");
    claudefyDir = join(homeDir, ".claudefy");

    // Create bare remote
    remoteDir = await mkdtemp(join(tmpdir(), "claudefy-push-remote-"));
    await simpleGit(remoteDir).init(true);

    // Create ~/.claude with test content
    await mkdir(join(claudeDir, "commands"), { recursive: true });
    await writeFile(join(claudeDir, "commands", "test.md"), "# Test Command");
    await mkdir(join(claudeDir, "agents"), { recursive: true });
    await writeFile(join(claudeDir, "agents", "my-agent.md"), "# Agent");
    await writeFile(join(claudeDir, "settings.json"), '{"key": "value"}');

    // Create denylisted items (should not be synced)
    await mkdir(join(claudeDir, "cache"), { recursive: true });
    await writeFile(join(claudeDir, "cache", "temp.dat"), "cached");

    // Create unknown items (should be synced encrypted)
    await mkdir(join(claudeDir, "get-shit-done"), { recursive: true });
    await writeFile(join(claudeDir, "get-shit-done", "VERSION"), "1.0.0");

    // Initialize claudefy config
    await mkdir(join(claudefyDir, "backups"), { recursive: true });
    await writeFile(
      join(claudefyDir, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: remoteDir },
        encryption: { enabled: false, useKeychain: false, cacheDuration: "0" },
        sync: { lfsThreshold: 512 * 1024 },
        filter: {},
        machineId: "test-machine-abc",
      })
    );
    await writeFile(join(claudefyDir, "links.json"), "{}");
    await writeFile(
      join(claudefyDir, "sync-filter.json"),
      JSON.stringify({
        allowlist: ["commands", "agents", "settings.json"],
        denylist: ["cache"],
      })
    );
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  it("pushes allowlisted files to remote store", async () => {
    const push = new PushCommand(homeDir);
    await push.execute({ quiet: false, skipEncryption: true });

    // Clone remote and verify
    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-verify-"));
    await simpleGit(verifyDir).clone(remoteDir, "store");
    const storePath = join(verifyDir, "store");

    const command = await readFile(
      join(storePath, "config", "commands", "test.md"),
      "utf-8"
    );
    expect(command).toBe("# Test Command");

    const agent = await readFile(
      join(storePath, "config", "agents", "my-agent.md"),
      "utf-8"
    );
    expect(agent).toBe("# Agent");

    await rm(verifyDir, { recursive: true, force: true });
  });

  it("does not push denylisted files", async () => {
    const push = new PushCommand(homeDir);
    await push.execute({ quiet: false, skipEncryption: true });

    const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-verify-"));
    await simpleGit(verifyDir).clone(remoteDir, "store");
    const storePath = join(verifyDir, "store");

    const entries = await readdir(join(storePath, "config")).catch(() => []);
    expect(entries).not.toContain("cache");

    await rm(verifyDir, { recursive: true, force: true });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test:run -- tests/commands/push.test.ts
```

**Step 3: Implement PushCommand**

```typescript
// src/commands/push.ts

import { cp, mkdir, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { ConfigManager } from "../config/config-manager.js";
import { SyncFilter } from "../sync-filter/sync-filter.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { MachineRegistry } from "../machine-registry/machine-registry.js";
import { hostname, platform } from "node:os";

export interface PushOptions {
  quiet: boolean;
  skipEncryption?: boolean;
}

export class PushCommand {
  private homeDir: string;
  private claudeDir: string;
  private configManager: ConfigManager;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
    this.claudeDir = join(homeDir, ".claude");
    this.configManager = new ConfigManager(homeDir);
  }

  async execute(options: PushOptions): Promise<void> {
    const config = await this.configManager.load();
    const syncFilterConfig = await this.configManager.getSyncFilter();
    const syncFilter = new SyncFilter(syncFilterConfig);

    // 1. Classify ~/.claude contents
    const classification = await syncFilter.classify(this.claudeDir);

    if (!options.quiet) {
      console.log(
        `Syncing: ${classification.allowlist.length} allowed, ` +
        `${classification.unknown.length} unknown (encrypted), ` +
        `${classification.denylist.length} denied`
      );
    }

    // 2. Initialize git adapter
    const gitAdapter = new GitAdapter(
      join(this.homeDir, ".claudefy")
    );
    await gitAdapter.initStore(config.backend.url);
    await gitAdapter.pull();

    const storePath = gitAdapter.getStorePath();
    const configDir = join(storePath, "config");
    const unknownDir = join(storePath, "unknown");

    // 3. Clean existing config and unknown dirs in store
    if (existsSync(configDir)) {
      await rm(configDir, { recursive: true });
    }
    if (existsSync(unknownDir)) {
      await rm(unknownDir, { recursive: true });
    }
    await mkdir(configDir, { recursive: true });
    await mkdir(unknownDir, { recursive: true });

    // 4. Copy allowlisted items
    for (const item of classification.allowlist) {
      const src = join(this.claudeDir, item.name);
      const dest = join(configDir, item.name);
      await cp(src, dest, { recursive: true });
    }

    // 5. Copy unknown items (TODO: encrypt when encryption is wired)
    for (const item of classification.unknown) {
      const src = join(this.claudeDir, item.name);
      const dest = join(unknownDir, item.name);
      await cp(src, dest, { recursive: true });
    }

    // 6. Update machine registry
    const registry = new MachineRegistry(join(storePath, "manifest.json"));
    await registry.register(config.machineId, hostname(), platform());

    // 7. Commit and push
    await gitAdapter.commitAndPush(`sync: push from ${config.machineId}`);

    if (!options.quiet) {
      console.log("Push complete.");
    }
  }
}
```

> **Implementation note:** This is the initial push without encryption or path remapping. Those get wired in Tasks 11.2 and 11.3 below.

**Step 4: Run tests**

```bash
npm run test:run -- tests/commands/push.test.ts
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add src/commands/ tests/commands/
git commit -m "feat: add push command with sync filter pipeline"
```

---

### Task 11.2: Wire Path Remapping into Push

**Files:**
- Modify: `src/commands/push.ts`
- Modify: `tests/commands/push.test.ts`

Add path normalization for `settings.json`, `history.jsonl`, `installed_plugins.json`, `known_marketplaces.json`, and `projects/` directory names after copying to store but before committing.

**Step 1: Add test case**

Add to `tests/commands/push.test.ts`:

```typescript
it("normalizes absolute paths in settings.json on push", async () => {
  await writeFile(
    join(claudeDir, "settings.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [{
          hooks: [{
            type: "command",
            command: `node "${claudeDir}/hooks/my-hook.js"`,
          }],
        }],
      },
    })
  );

  // Update sync filter to include settings.json
  const push = new PushCommand(homeDir);
  await push.execute({ quiet: true, skipEncryption: true });

  const verifyDir = await mkdtemp(join(tmpdir(), "claudefy-verify-"));
  await simpleGit(verifyDir).clone(remoteDir, "store");
  const settings = JSON.parse(
    await readFile(join(verifyDir, "store", "config", "settings.json"), "utf-8")
  );
  expect(settings.hooks.SessionStart[0].hooks[0].command).toContain("@@CLAUDE_DIR@@");
  expect(settings.hooks.SessionStart[0].hooks[0].command).not.toContain(claudeDir);

  await rm(verifyDir, { recursive: true, force: true });
});
```

**Step 2: Run test to verify it fails, then implement path normalization in push.ts**

After copying allowlisted items to store, add a normalization step:

```typescript
// In push.execute(), after step 4 (copy allowlisted items):

// 4b. Normalize paths in known files
const links = await this.configManager.getLinks();
const pathMapper = new PathMapper(links);

// settings.json
const settingsPath = join(configDir, "settings.json");
if (existsSync(settingsPath)) {
  const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
  const normalized = pathMapper.normalizeSettingsPaths(settings, this.claudeDir);
  await writeFile(settingsPath, JSON.stringify(normalized, null, 2));
}

// installed_plugins.json
const pluginsJsonPath = join(configDir, "plugins", "installed_plugins.json");
if (existsSync(pluginsJsonPath)) {
  const plugins = JSON.parse(await readFile(pluginsJsonPath, "utf-8"));
  const normalized = pathMapper.normalizePluginPaths(plugins, this.claudeDir);
  await writeFile(pluginsJsonPath, JSON.stringify(normalized, null, 2));
}

// known_marketplaces.json
const marketplacesPath = join(configDir, "plugins", "known_marketplaces.json");
if (existsSync(marketplacesPath)) {
  const mp = JSON.parse(await readFile(marketplacesPath, "utf-8"));
  const normalized = pathMapper.normalizePluginPaths(mp, this.claudeDir);
  await writeFile(marketplacesPath, JSON.stringify(normalized, null, 2));
}

// history.jsonl
const historyPath = join(configDir, "history.jsonl");
if (existsSync(historyPath)) {
  const content = await readFile(historyPath, "utf-8");
  const normalized = content
    .split("\n")
    .filter(Boolean)
    .map((line) => pathMapper.normalizeJsonlLine(line))
    .join("\n") + "\n";
  await writeFile(historyPath, normalized);
}

// projects/ directory renaming
const projectsDir = join(configDir, "projects");
if (existsSync(projectsDir)) {
  const projectDirs = await readdir(projectsDir);
  for (const dirName of projectDirs) {
    const canonicalId = pathMapper.normalizeDirName(dirName);
    if (canonicalId) {
      await rename(join(projectsDir, dirName), join(projectsDir, canonicalId));
    }
  }
}
```

**Step 3: Run tests, verify pass, commit**

```bash
npm run test:run -- tests/commands/push.test.ts
git add src/commands/ tests/commands/
git commit -m "feat: wire path remapping into push pipeline"
```

---

### Task 11.3: Wire Encryption into Push

**Files:**
- Modify: `src/commands/push.ts`
- Modify: `tests/commands/push.test.ts`

After path normalization, encrypt files that need encryption:
- `settings.json` → `settings.json.age`
- `history.jsonl` → `history.jsonl.age`
- All files in `unknown/` → `*.age`

Implementation: Walk the store directory, check each file against encryption rules, encrypt in-place and rename with `.age` extension.

**Step 1: Add test, step 2: implement, step 3: run and commit**

Same TDD pattern. Test verifies encrypted files are not readable as plaintext and have `.age` extension.

```bash
git commit -m "feat: wire selective encryption into push pipeline"
```

---

## Phase 12: Pull Command — Full Pipeline

### Task 12.1: Orchestrate Pull Flow

**Files:**
- Create: `src/commands/pull.ts`
- Test: `tests/commands/pull.test.ts`

Pull is the reverse of push:
1. `git pull` from remote
2. Detect override marker → warn + backup + prompt
3. Decrypt `.age` files
4. Remap paths (canonical → local)
5. Merge: deep JSON merge for `settings.json`, LWW for everything else
6. Copy from store to `~/.claude`
7. Update machine registry last sync time

**Step 1: Write failing test**

Test that pull correctly writes files from remote store to `~/.claude`, remaps paths back to local, and decrypts encrypted files.

**Step 2: Implement PullCommand following same pattern as PushCommand**

**Step 3: Run tests, commit**

```bash
git commit -m "feat: add pull command with decrypt, remap, and merge"
```

---

### Task 12.2: Override Detection on Pull

Add logic to PullCommand: after `git pull`, check for `.override` marker. If present, warn user, create backup, prompt for confirmation, then apply full overwrite instead of merge.

```bash
git commit -m "feat: add override detection and backup on pull"
```

---

## Phase 13: Override Command

### Task 13.1: Double-Confirmation Override

**Files:**
- Create: `src/commands/override.ts`
- Test: `tests/commands/override.test.ts`

Implementation:
1. Prompt: "Type 'override' to confirm"
2. Prompt: "Are you absolutely sure? [y/N]"
3. Call `gitAdapter.wipeAndPush(machineId)`
4. Run full push pipeline to repopulate store

```bash
git commit -m "feat: add override command with double confirmation"
```

---

## Phase 14: Remaining Commands

### Task 14.1: `init` Command

**Files:**
- Create: `src/commands/init.ts`
- Test: `tests/commands/init.test.ts`

Flow:
1. If `--backend` not provided, prompt interactively (URL or create repo)
2. If `--create-repo`, use `gh repo create` or `glab` CLI
3. Create `~/.claudefy/` with config, machine-id, links, sync-filter
4. Set up passphrase (prompt, store in env/keychain)
5. Initialize git adapter (clone or init+push)
6. Run initial push

```bash
git commit -m "feat: add init command with interactive setup"
```

### Task 14.2: `join` Command

**Files:**
- Create: `src/commands/join.ts`
- Test: `tests/commands/join.test.ts`

Flow:
1. Clone remote store
2. Prompt for passphrase
3. Create `~/.claudefy/` config
4. Register machine
5. Run pull

```bash
git commit -m "feat: add join command for subsequent machines"
```

### Task 14.3: `status` Command

**Files:**
- Create: `src/commands/status.ts`

Diff local `~/.claude` against remote store. Show which files would be pushed/pulled.

```bash
git commit -m "feat: add status command"
```

### Task 14.4: `link` / `unlink` / `links` Commands

**Files:**
- Create: `src/commands/link.ts`

Wire up `ConfigManager.addLink()` / `removeLink()` / `getLinks()` with GitIdentity auto-detection.

```bash
git commit -m "feat: add link/unlink/links commands"
```

### Task 14.5: `config` Command

**Files:**
- Create: `src/commands/config.ts`

Wire up `ConfigManager.set()` / `load()`.

```bash
git commit -m "feat: add config get/set command"
```

### Task 14.6: `machines` Command

**Files:**
- Create: `src/commands/machines.ts`

Read manifest.json from store, display formatted table.

```bash
git commit -m "feat: add machines command"
```

### Task 14.7: `doctor` Command

**Files:**
- Create: `src/commands/doctor.ts`
- Test: `tests/commands/doctor.test.ts`

Checks:
- git installed and version
- git-lfs installed
- age CLI installed (if using CLI mode)
- Remote store reachable
- `~/.claudefy/config.json` valid
- `~/.claude` exists and readable
- Passphrase available (env var or keychain)

```bash
git commit -m "feat: add doctor diagnostic command"
```

### Task 14.8: `hooks install` / `hooks remove` Commands

Wire HookManager into CLI commands.

```bash
git commit -m "feat: wire hooks install/remove commands"
```

---

## Phase 15: Repo Creator Module

### Task 15.1: Auto-Create GitHub/GitLab Repos

**Files:**
- Create: `src/repo-creator/repo-creator.ts`
- Test: `tests/repo-creator/repo-creator.test.ts`

Uses `gh repo create <name> --private` or `glab project create`. Detect which CLI is available via `which`. Return the git URL for the new repo.

```bash
git commit -m "feat: add repo creator for GitHub/GitLab"
```

---

## Phase 16: Integration Testing

### Task 16.1: End-to-End Test — Full Sync Cycle

**Files:**
- Create: `tests/integration/full-sync.test.ts`

Test the complete flow:
1. Machine A: `init` → create test content → `push`
2. Machine B: `join` → verify content arrived → modify content → `push`
3. Machine A: `pull` → verify Machine B's changes arrived
4. Machine A: `override` → `push`
5. Machine B: `pull` → detect override → verify backup created

```bash
git commit -m "test: add end-to-end sync cycle integration test"
```

### Task 16.2: Path Remapping Integration Test

**Files:**
- Create: `tests/integration/path-remapping.test.ts`

Test:
1. Machine A at `/home/jose/projects/kodrun` → push with normalized paths
2. Machine B at `/Users/jose/dev/kodrun` → pull → verify paths remapped correctly
3. Verify `history.jsonl` project fields remapped
4. Verify `projects/` directory names remapped
5. Verify `settings.json` hook paths remapped

```bash
git commit -m "test: add path remapping integration test"
```

---

## Phase 17: Polish & Distribution

### Task 17.1: CLI Output Formatting

Add colored output, progress indicators, and summary tables for all commands. Use `chalk` for colors.

```bash
npm install chalk
git commit -m "feat: add formatted CLI output with colors"
```

### Task 17.2: npm Distribution Setup

**Files:**
- Modify: `package.json` (add `name`, `description`, `keywords`, `repository`, `files`)
- Create: `.npmignore`

```json
{
  "name": "claudefy",
  "description": "Sync your Claude Code environment across machines",
  "keywords": ["claude", "claude-code", "sync", "cli"],
  "repository": "github:kodrunhq/claudefy",
  "files": ["dist", "README.md", "LICENSE"]
}
```

```bash
git commit -m "chore: configure npm distribution"
```

### Task 17.3: LFS Configuration

**Files:**
- Create: `.gitattributes` (in store template)

During `init`, write `.gitattributes` to the store repo:

```
projects/**/*.jsonl filter=lfs diff=lfs merge=lfs -text
projects/**/*.jsonl.age filter=lfs diff=lfs merge=lfs -text
```

```bash
git commit -m "feat: add git-lfs configuration for session files"
```

---

## Summary of Phases

| Phase | Description | Tasks |
|---|---|---|
| 1 | Project scaffolding & config module | 1.1, 1.2 |
| 2 | Sync filter module | 2.1 |
| 3 | Path mapper module | 3.1, 3.2 |
| 4 | Encryptor module | 4.1 |
| 5 | Secret scanner module | 5.1 |
| 6 | Git adapter module | 6.1 |
| 7 | Merger module | 7.1 |
| 8 | Backup manager module | 8.1 |
| 9 | Hook manager module | 9.1 |
| 10 | Machine registry module | 10.1 |
| 11 | Push command (full pipeline) | 11.1, 11.2, 11.3 |
| 12 | Pull command (full pipeline) | 12.1, 12.2 |
| 13 | Override command | 13.1 |
| 14 | Remaining CLI commands | 14.1–14.8 |
| 15 | Repo creator module | 15.1 |
| 16 | Integration testing | 16.1, 16.2 |
| 17 | Polish & distribution | 17.1–17.3 |

**Total tasks:** 30
**Each task follows TDD:** write test → verify fail → implement → verify pass → commit
