# Post-MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete claudefy for public release with README, CI/CD + linting, missing commands/features, and npm publish prep.

**Architecture:** Four independent PRs (README, CI/CD, Features, Publish) that can be implemented in parallel except PR 4 which depends on PRs 1-3.

**Tech Stack:** TypeScript, ESLint, Prettier, GitHub Actions, npm, chalk, Commander.js, simple-git, vitest

**Design Doc:** `docs/plans/2026-03-10-post-mvp-design.md`

---

## Phase 18: README Documentation

### Task 18.1: Write Comprehensive README

**Files:**
- Modify: `README.md`

**Step 1: Write README.md**

Write a complete README covering:

```markdown
# claudefy

Sync your Claude Code environment across machines.

## What It Does

claudefy syncs your `~/.claude` directory (commands, skills, agents, hooks, rules, plans, plugins, settings, and project configs) across multiple machines using a private git repository as the backend. It handles:

- **Selective sync** — three-tier filter (allow/deny/unknown) controls what syncs
- **Encryption** — sensitive and unknown files encrypted with age before push
- **Path remapping** — machine-specific paths normalized to canonical IDs
- **Deep merge** — settings.json merged at the key level; other files use last-write-wins
- **Override** — wipe remote and push local as source of truth when needed

## Install

\`\`\`bash
npm install -g claudefy
\`\`\`

## Quick Start

**First machine (initialize):**

\`\`\`bash
# Create a private repo (requires gh or glab CLI)
claudefy init --backend git@github.com:you/claude-sync.git

# Or auto-create a GitHub repo
claudefy init --create-repo
\`\`\`

**Second machine (join):**

\`\`\`bash
claudefy join --backend git@github.com:you/claude-sync.git
\`\`\`

**Daily use:**

\`\`\`bash
claudefy push     # Push local changes to remote
claudefy pull     # Pull remote changes to local
claudefy status   # Show sync status
\`\`\`

## Commands

### Core Sync

| Command | Description |
|---------|-------------|
| `claudefy init --backend <url>` | Initialize store on first machine |
| `claudefy join --backend <url>` | Join store from another machine |
| `claudefy push` | Push local state to remote |
| `claudefy pull` | Pull remote state to local |
| `claudefy override --confirm` | Wipe remote, push local as source of truth |
| `claudefy status` | Show file classification and sync state |

### Project Mapping

| Command | Description |
|---------|-------------|
| `claudefy link <alias> <path>` | Map a local project path to a canonical ID |
| `claudefy unlink <alias>` | Remove a project mapping |
| `claudefy links` | List all project mappings |

### Configuration

| Command | Description |
|---------|-------------|
| `claudefy config get [key]` | Show config or a specific key |
| `claudefy config set <key> <value>` | Update a config value |
| `claudefy doctor` | Diagnose sync health |
| `claudefy machines` | List registered machines |

### Hooks

| Command | Description |
|---------|-------------|
| `claudefy hooks install` | Install auto-sync hooks (push on SessionEnd, pull on SessionStart) |
| `claudefy hooks remove` | Remove auto-sync hooks |

### Options

Pass `--hooks` to `init` or `join` to install auto-sync hooks automatically.

## Global Options

| Option | Description |
|--------|-------------|
| `-q, --quiet` | Suppress output |
| `--skip-encryption` | Skip encryption (for testing) |
| `--passphrase <passphrase>` | Encryption passphrase (prefer `CLAUDEFY_PASSPHRASE` env var) |

## Encryption

claudefy encrypts files using [age](https://age-encryption.org/) (WASM-based, no native binary needed).

**Passphrase resolution order:**
1. `CLAUDEFY_PASSPHRASE` environment variable
2. OS keychain (requires `keytar`: `npm install -g keytar`)
3. Passed via `--passphrase` (avoid — visible in process list)

**What gets encrypted:**
- Files in the "unknown" tier (not in allowlist or denylist) are always encrypted
- Allowlisted files can optionally be encrypted via config

## How It Works

1. **Sync filter** classifies each entry in `~/.claude` as allow, deny, or unknown
2. **Push**: copies allowed files to git store, encrypts unknowns, normalizes paths, commits and pushes
3. **Pull**: fetches from remote, decrypts, remaps paths to local machine, merges (deep merge for JSON, LWW for others)
4. **Path remapping**: project directories use canonical IDs derived from git remotes (e.g., `github.com--owner--repo`)

## Configuration

Config lives at `~/.claudefy/config.json`:

\`\`\`json
{
  "version": 1,
  "backend": { "type": "git", "url": "git@github.com:you/claude-sync.git" },
  "encryption": { "enabled": true, "useKeychain": false },
  "sync": { "lfsThreshold": 524288 },
  "machineId": "hostname-abc12345"
}
\`\`\`

Modify via `claudefy config set`:

\`\`\`bash
claudefy config set encryption.enabled false
claudefy config set encryption.useKeychain true
\`\`\`

## Security

- Passphrases never stored in plain text on disk
- Secret scanner detects API keys, tokens, and high-entropy strings before push
- Unknown files always encrypted — never pushed in cleartext
- `--passphrase` CLI flag warns about process list exposure

## License

MIT
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add comprehensive README with usage docs"
```

---

## Phase 19: CI/CD Pipeline + Linting

### Task 19.1: ESLint + Prettier Setup

**Files:**
- Create: `eslint.config.js`
- Create: `.prettierrc`
- Modify: `package.json` (add devDependencies and scripts)

**Step 1: Install linting dependencies**

```bash
npm install -D eslint @eslint/js @typescript-eslint/eslint-plugin @typescript-eslint/parser typescript-eslint prettier
```

**Step 2: Create eslint.config.js**

```javascript
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/", "node_modules/", "*.config.js"],
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
```

**Step 3: Create .prettierrc**

Look at the existing code style (semicolons, quotes, trailing commas, indentation) and match it exactly. Create `.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "tabWidth": 2,
  "printWidth": 100
}
```

**Step 4: Add scripts to package.json**

Add to `scripts`:
```json
{
  "lint": "eslint src/ tests/",
  "lint:fix": "eslint src/ tests/ --fix",
  "format": "prettier --write src/ tests/",
  "format:check": "prettier --check src/ tests/"
}
```

**Step 5: Run lint and format, fix any issues**

```bash
npx eslint src/ tests/
npx prettier --check src/ tests/
```

Fix all lint and format errors. This may require running `npx prettier --write src/ tests/` and addressing any ESLint violations.

**Step 6: Run tests to verify nothing broke**

```bash
npx vitest run
```

**Step 7: Commit**

```bash
git add eslint.config.js .prettierrc package.json package-lock.json src/ tests/
git commit -m "chore: add ESLint and Prettier with initial lint fixes"
```

### Task 19.2: CI Workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Create CI workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    name: Lint & Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: ESLint
        run: npx eslint src/ tests/

      - name: Prettier
        run: npx prettier --check src/ tests/

      - name: TypeScript
        run: npx tsc --noEmit

  test:
    name: Test (Node ${{ matrix.node-version }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node-version: ["18", "20", "22"]
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npx vitest run

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: [lint, test]
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/
```

**Step 2: Commit**

```bash
mkdir -p .github/workflows
git add .github/workflows/ci.yml
git commit -m "ci: add CI workflow with lint, test matrix, and build"
```

### Task 19.3: Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Step 1: Create release workflow**

```yaml
name: Release

on:
  workflow_dispatch:
    inputs:
      version_bump:
        description: "Version bump type"
        required: true
        type: choice
        options:
          - patch
          - minor
          - major

permissions:
  contents: write

jobs:
  release:
    name: Create Release
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GH_TOKEN }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npx vitest run

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - name: Bump version
        run: npm version ${{ inputs.version_bump }} -m "release: v%s"

      - name: Push tag
        run: git push --follow-tags

      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ secrets.GH_TOKEN }}
        run: |
          VERSION=$(node -p "require('./package.json').version")
          gh release create "v${VERSION}" \
            --title "v${VERSION}" \
            --generate-notes
```

**Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add manual release workflow with version bump"
```

### Task 19.4: Publish Workflow

**Files:**
- Create: `.github/workflows/publish.yml`

**Step 1: Create publish workflow**

```yaml
name: Publish to npm

on:
  release:
    types: [published]

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    name: Publish
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          registry-url: "https://registry.npmjs.org"

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Smoke test
        run: |
          npm pack
          TARBALL=$(ls claudefy-*.tgz)
          npm install -g "./${TARBALL}"
          claudefy --version
          claudefy --help

      - name: Publish to npm
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Step 2: Commit**

```bash
git add .github/workflows/publish.yml
git commit -m "ci: add npm publish workflow triggered on release"
```

---

## Phase 20: Feature Completion

### Task 20.1: Config Command

**Files:**
- Create: `src/commands/config.ts`
- Create: `tests/commands/config.test.ts`
- Modify: `src/cli.ts`

**Step 1: Write the failing test**

Create `tests/commands/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConfigCommand } from "../../src/commands/config.js";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ConfigCommand", () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-config-test-"));
    const claudefyDir = join(homeDir, ".claudefy");
    await mkdir(claudefyDir, { recursive: true });
    await writeFile(
      join(claudefyDir, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: "https://example.com/repo.git" },
        encryption: { enabled: true, useKeychain: false, cacheDuration: "0" },
        sync: { lfsThreshold: 524288 },
        filter: {},
        machineId: "test-machine",
      }),
    );
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  it("gets full config", async () => {
    const cmd = new ConfigCommand(homeDir);
    const result = await cmd.get();
    expect(result.version).toBe(1);
    expect(result.machineId).toBe("test-machine");
  });

  it("gets a specific key", async () => {
    const cmd = new ConfigCommand(homeDir);
    const result = await cmd.get("encryption.enabled");
    expect(result).toBe(true);
  });

  it("gets a nested key", async () => {
    const cmd = new ConfigCommand(homeDir);
    const result = await cmd.get("backend.url");
    expect(result).toBe("https://example.com/repo.git");
  });

  it("throws for invalid key path", async () => {
    const cmd = new ConfigCommand(homeDir);
    await expect(cmd.get("nonexistent.key")).rejects.toThrow(/Invalid config key/);
  });

  it("sets a value", async () => {
    const cmd = new ConfigCommand(homeDir);
    await cmd.set("encryption.enabled", false);
    const result = await cmd.get("encryption.enabled");
    expect(result).toBe(false);
  });

  it("throws when not initialized", async () => {
    const emptyHome = await mkdtemp(join(tmpdir(), "claudefy-config-empty-"));
    const cmd = new ConfigCommand(emptyHome);
    await expect(cmd.get()).rejects.toThrow(/not initialized/);
    await rm(emptyHome, { recursive: true, force: true });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/commands/config.test.ts
```

Expected: FAIL — module `../../src/commands/config.js` not found.

**Step 3: Write implementation**

Create `src/commands/config.ts`:

```typescript
import { ConfigManager } from "../config/config-manager.js";

export class ConfigCommand {
  private homeDir: string;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
  }

  async get(key?: string): Promise<unknown> {
    const configManager = new ConfigManager(this.homeDir);
    if (!configManager.isInitialized()) {
      throw new Error("claudefy is not initialized. Run 'claudefy init' first.");
    }

    const config = await configManager.load();

    if (!key) return config;

    const parts = key.split(".");
    let current: unknown = config;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== "object") {
        throw new Error(`Invalid config key: "${key}"`);
      }
      current = (current as Record<string, unknown>)[part];
      if (current === undefined) {
        throw new Error(`Invalid config key: "${key}"`);
      }
    }
    return current;
  }

  async set(key: string, value: unknown): Promise<void> {
    const configManager = new ConfigManager(this.homeDir);
    if (!configManager.isInitialized()) {
      throw new Error("claudefy is not initialized. Run 'claudefy init' first.");
    }

    // Parse value: "true"→true, "false"→false, numbers→number, else string
    const parsed = this.parseValue(value);
    await configManager.set(key, parsed);
  }

  private parseValue(value: unknown): unknown {
    if (typeof value !== "string") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== "") return num;
    return value;
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/commands/config.test.ts
```

Expected: all 6 tests PASS.

**Step 5: Wire into CLI**

Add to `src/cli.ts`, after the `machines` command block and before `hooksCmd`:

```typescript
const configCmd = program
  .command("config")
  .description("Manage claudefy configuration");

configCmd
  .command("get [key]")
  .description("Show full config or a specific key")
  .action(async (key?: string) => {
    try {
      const { ConfigCommand } = await import("./commands/config.js");
      const cmd = new ConfigCommand(homeDir);
      const result = await cmd.get(key);
      console.log(typeof result === "object" ? JSON.stringify(result, null, 2) : String(result));
    } catch (err: any) {
      output.error(err.message);
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
    } catch (err: any) {
      output.error(err.message);
      process.exit(1);
    }
  });
```

**Step 6: Run all tests**

```bash
npx vitest run
```

**Step 7: Commit**

```bash
git add src/commands/config.ts tests/commands/config.test.ts src/cli.ts
git commit -m "feat: add config get/set command with dot-notation key support"
```

### Task 20.2: Doctor Command

**Files:**
- Create: `src/commands/doctor.ts`
- Create: `tests/commands/doctor.test.ts`
- Modify: `src/cli.ts`

**Step 1: Write the failing test**

Create `tests/commands/doctor.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DoctorCommand, DoctorCheck } from "../../src/commands/doctor.js";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("DoctorCommand", () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-doctor-test-"));
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  it("reports git as available", async () => {
    const cmd = new DoctorCommand(homeDir);
    const checks = await cmd.execute();
    const gitCheck = checks.find((c) => c.name === "git");
    expect(gitCheck).toBeDefined();
    expect(gitCheck!.status).toBe("pass");
  });

  it("reports not initialized when no config", async () => {
    const cmd = new DoctorCommand(homeDir);
    const checks = await cmd.execute();
    const initCheck = checks.find((c) => c.name === "store-initialized");
    expect(initCheck).toBeDefined();
    expect(initCheck!.status).toBe("fail");
  });

  it("reports initialized when config exists", async () => {
    const claudefyDir = join(homeDir, ".claudefy");
    await mkdir(claudefyDir, { recursive: true });
    await writeFile(
      join(claudefyDir, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: "https://example.com/repo.git" },
        encryption: { enabled: true, useKeychain: false, cacheDuration: "0" },
        sync: { lfsThreshold: 524288 },
        filter: {},
        machineId: "test-machine",
      }),
    );

    const cmd = new DoctorCommand(homeDir);
    const checks = await cmd.execute();
    const initCheck = checks.find((c) => c.name === "store-initialized");
    expect(initCheck!.status).toBe("pass");
  });

  it("reports encryption status", async () => {
    const claudefyDir = join(homeDir, ".claudefy");
    await mkdir(claudefyDir, { recursive: true });
    await writeFile(
      join(claudefyDir, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: "https://example.com/repo.git" },
        encryption: { enabled: true, useKeychain: false, cacheDuration: "0" },
        sync: { lfsThreshold: 524288 },
        filter: {},
        machineId: "test-machine",
      }),
    );

    const cmd = new DoctorCommand(homeDir);
    const checks = await cmd.execute();
    const encCheck = checks.find((c) => c.name === "encryption");
    expect(encCheck).toBeDefined();
    expect(encCheck!.status).toBe("pass");
    expect(encCheck!.detail).toContain("enabled");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/commands/doctor.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write implementation**

Create `src/commands/doctor.ts`:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ConfigManager } from "../config/config-manager.js";

const execFileAsync = promisify(execFile);

export interface DoctorCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

export class DoctorCommand {
  private homeDir: string;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
  }

  async execute(): Promise<DoctorCheck[]> {
    const checks: DoctorCheck[] = [];

    checks.push(await this.checkBinary("git", "git --version"));
    checks.push(await this.checkBinary("git-lfs", "git lfs version"));
    checks.push(this.checkInitialized());

    const configManager = new ConfigManager(this.homeDir);
    if (configManager.isInitialized()) {
      const config = await configManager.load();
      checks.push(this.checkEncryption(config));
      checks.push(await this.checkRemote(config.backend.url));
    }

    return checks;
  }

  private async checkBinary(name: string, command: string): Promise<DoctorCheck> {
    const [cmd, ...args] = command.split(" ");
    try {
      const { stdout } = await execFileAsync(cmd, args);
      return { name, status: "pass", detail: stdout.trim().split("\n")[0] };
    } catch {
      return { name, status: "fail", detail: `${name} not found in PATH` };
    }
  }

  private checkInitialized(): DoctorCheck {
    const configManager = new ConfigManager(this.homeDir);
    if (configManager.isInitialized()) {
      return { name: "store-initialized", status: "pass", detail: "claudefy is initialized" };
    }
    return {
      name: "store-initialized",
      status: "fail",
      detail: "Not initialized. Run 'claudefy init' first.",
    };
  }

  private checkEncryption(config: { encryption: { enabled: boolean } }): DoctorCheck {
    if (config.encryption.enabled) {
      return { name: "encryption", status: "pass", detail: "encryption enabled" };
    }
    return { name: "encryption", status: "warn", detail: "encryption disabled — files pushed in cleartext" };
  }

  private async checkRemote(url: string): Promise<DoctorCheck> {
    try {
      await execFileAsync("git", ["ls-remote", "--exit-code", url], { timeout: 10000 });
      return { name: "remote-reachable", status: "pass", detail: `remote ${url} is reachable` };
    } catch {
      return { name: "remote-reachable", status: "fail", detail: `Cannot reach remote: ${url}` };
    }
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/commands/doctor.test.ts
```

Expected: all 4 tests PASS.

**Step 5: Wire into CLI**

Add to `src/cli.ts`, before the `hooksCmd` block:

```typescript
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
    } catch (err: any) {
      output.error(err.message);
      process.exit(1);
    }
  });
```

**Step 6: Run all tests**

```bash
npx vitest run
```

**Step 7: Commit**

```bash
git add src/commands/doctor.ts tests/commands/doctor.test.ts src/cli.ts
git commit -m "feat: add doctor command for sync health diagnostics"
```

### Task 20.3: RepoCreator Integration into Init

**Files:**
- Modify: `src/commands/init.ts`
- Modify: `src/cli.ts`
- Create: `tests/commands/init-create-repo.test.ts`

**Step 1: Write the failing test**

Create `tests/commands/init-create-repo.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InitCommand } from "../../src/commands/init.js";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";

describe("InitCommand --create-repo", () => {
  let homeDir: string;
  let remoteDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-init-repo-test-"));
    const claudeDir = join(homeDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, "settings.json"), '{"key": "value"}');

    remoteDir = await mkdtemp(join(tmpdir(), "claudefy-init-repo-remote-"));
    await simpleGit(remoteDir).init(true);
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  it("uses RepoCreator when createRepo is true and no backend", async () => {
    const cmd = new InitCommand(homeDir);

    // Mock the RepoCreator to return our test remote
    const { RepoCreator } = await import("../../src/repo-creator/repo-creator.js");
    vi.spyOn(RepoCreator.prototype, "create").mockResolvedValue(remoteDir);

    await cmd.execute({
      backend: undefined as unknown as string,
      quiet: true,
      skipEncryption: true,
      createRepo: true,
    });

    expect(RepoCreator.prototype.create).toHaveBeenCalled();
  });

  it("throws when no backend and no createRepo", async () => {
    const cmd = new InitCommand(homeDir);
    await expect(
      cmd.execute({
        backend: undefined as unknown as string,
        quiet: true,
        skipEncryption: true,
      }),
    ).rejects.toThrow(/backend/i);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/commands/init-create-repo.test.ts
```

Expected: FAIL — `createRepo` not recognized, backend required.

**Step 3: Modify InitCommand**

Update `src/commands/init.ts`:

Add `createRepo?: boolean` to `InitOptions`.

At the top of `execute()`, before the config initialization, add:

```typescript
let backend = options.backend;

if (!backend && options.createRepo) {
  const { RepoCreator } = await import("../repo-creator/repo-creator.js");
  const creator = new RepoCreator();
  const repoName = "claude-sync";
  backend = await creator.create(repoName);
  if (!options.quiet) {
    output.info(`Created remote repository: ${backend}`);
  }
}

if (!backend) {
  throw new Error("Either --backend <url> or --create-repo is required.");
}
```

Then use `backend` instead of `options.backend` in the rest of the method.

**Step 4: Update CLI**

In `src/cli.ts`, update the `init` command:

- Change `--backend` from `requiredOption` to `option` (since `--create-repo` can replace it)
- Add `.option("--create-repo", "Auto-create a GitHub/GitLab repo")`
- Pass `createRepo: options.createRepo ?? false` and `backend: options.backend` to execute

**Step 5: Run tests**

```bash
npx vitest run
```

**Step 6: Commit**

```bash
git add src/commands/init.ts src/cli.ts tests/commands/init-create-repo.test.ts
git commit -m "feat: add --create-repo flag to init command"
```

### Task 20.4: Keytar as Optional Peer Dependency

**Files:**
- Modify: `package.json`

**Step 1: Add keytar to peerDependencies**

Add to `package.json`:

```json
{
  "peerDependencies": {
    "keytar": ">=7.0.0"
  },
  "peerDependenciesMeta": {
    "keytar": {
      "optional": true
    }
  }
}
```

**Step 2: Run tests**

```bash
npx vitest run
```

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: declare keytar as optional peer dependency"
```

---

## Phase 21: First Publish Prep

> **Depends on:** Phases 18, 19, 20 must be merged to main first.

### Task 21.1: LICENSE and Version Bump

**Files:**
- Create: `LICENSE`
- Modify: `package.json` (version bump)

**Step 1: Create MIT LICENSE**

```
MIT License

Copyright (c) 2026 Kodrun

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**Step 2: Bump version to 1.0.0**

```bash
npm version 1.0.0 --no-git-tag-version
```

**Step 3: Final smoke test**

```bash
npm run build
npm pack
TARBALL=$(ls claudefy-*.tgz)
npm install -g "./${TARBALL}"
claudefy --version
claudefy --help
npm uninstall -g claudefy
rm "${TARBALL}"
```

**Step 4: Run all tests**

```bash
npx vitest run
```

**Step 5: Commit**

```bash
git add LICENSE package.json package-lock.json
git commit -m "chore: add MIT license and bump to v1.0.0"
```

---

## Summary of Phases

| Phase | PR | Description | Tasks |
|-------|-----|-------------|-------|
| 18 | PR 1 | README documentation | 18.1 |
| 19 | PR 2 | CI/CD + linting | 19.1, 19.2, 19.3, 19.4 |
| 20 | PR 3 | Feature completion | 20.1, 20.2, 20.3, 20.4 |
| 21 | PR 4 | First publish prep | 21.1 |

**Total tasks:** 10
**Parallelizable:** Phases 18, 19, 20 (PRs 1-3) are fully independent.
**Sequential:** Phase 21 (PR 4) depends on PRs 1-3 being merged.
