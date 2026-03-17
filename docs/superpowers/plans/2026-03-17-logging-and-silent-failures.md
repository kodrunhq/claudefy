# Logging Infrastructure & Silent Failure Fixes

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent file-based logging and fix silent failure modes in hook-triggered push/pull operations.

**Architecture:** A `Logger` writes structured log entries to `~/.claudefy/logs/sync.log` with automatic size-based rotation. A `Lockfile` provides process-level mutual exclusion with retry logic. Both are injected into push/pull commands. The `--quiet` flag suppresses console output but never suppresses file logging. Doctor gains a `recent-failures` check that reads the log.

**Tech Stack:** Node.js fs/promises, no new dependencies. Vitest for tests.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/logger.ts` | `Logger` class: structured file logging with rotation |
| `src/lockfile.ts` | `Lockfile` class: acquire/release with PID, retry, staleness detection |
| `src/commands/push.ts` | Integrate logger + lockfile, log all outcomes |
| `src/commands/pull.ts` | Integrate logger + lockfile, log all outcomes |
| `src/commands/doctor.ts` | Add `recent-sync` check that reads last N log entries |
| `src/cli.ts` | Add `claudefy logs` command |
| `tests/logger.test.ts` | Logger unit tests |
| `tests/lockfile.test.ts` | Lockfile unit tests |
| `tests/commands/doctor.test.ts` | New doctor check test |

---

## Chunk 1: Logger

### Task 1: Logger — tests and implementation

**Files:**
- Create: `src/logger.ts`
- Create: `tests/logger.test.ts`

- [ ] **Step 1: Write failing tests for Logger**

```typescript
// tests/logger.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Logger, LogEntry } from "../src/logger.js";
import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

describe("Logger", () => {
  let logDir: string;
  let logFile: string;
  let logger: Logger;

  beforeEach(async () => {
    logDir = await mkdtemp(join(tmpdir(), "claudefy-logger-test-"));
    logFile = join(logDir, "sync.log");
    logger = new Logger(logFile);
  });

  afterEach(async () => {
    await rm(logDir, { recursive: true, force: true });
  });

  it("creates log file on first write", async () => {
    await logger.log("info", "push", "started");
    expect(existsSync(logFile)).toBe(true);
  });

  it("writes structured log entries", async () => {
    await logger.log("info", "push", "Push complete");
    const content = await readFile(logFile, "utf-8");
    const entry: LogEntry = JSON.parse(content.trim());
    expect(entry.level).toBe("info");
    expect(entry.operation).toBe("push");
    expect(entry.message).toBe("Push complete");
    expect(entry.timestamp).toBeDefined();
  });

  it("appends multiple entries", async () => {
    await logger.log("info", "push", "started");
    await logger.log("info", "push", "complete");
    const content = await readFile(logFile, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("rotates when file exceeds maxBytes", async () => {
    const smallLogger = new Logger(logFile, { maxBytes: 200 });
    for (let i = 0; i < 20; i++) {
      await smallLogger.log("info", "push", `entry ${i}`);
    }
    const stats = await stat(logFile);
    expect(stats.size).toBeLessThan(400);
    expect(existsSync(logFile + ".1")).toBe(true);
  });

  it("keeps at most maxFiles rotated files", async () => {
    const smallLogger = new Logger(logFile, { maxBytes: 100, maxFiles: 2 });
    for (let i = 0; i < 50; i++) {
      await smallLogger.log("info", "push", `entry ${i}`);
    }
    expect(existsSync(logFile + ".1")).toBe(true);
    expect(existsSync(logFile + ".2")).toBe(true);
    expect(existsSync(logFile + ".3")).toBe(false);
  });

  it("readRecent returns last N entries", async () => {
    for (let i = 0; i < 5; i++) {
      await logger.log("info", "push", `entry ${i}`);
    }
    const recent = await logger.readRecent(3);
    expect(recent).toHaveLength(3);
    expect(recent[0].message).toBe("entry 2");
    expect(recent[2].message).toBe("entry 4");
  });

  it("readRecent returns empty array when no log file", async () => {
    const noFileLogger = new Logger(join(logDir, "missing.log"));
    const recent = await noFileLogger.readRecent(10);
    expect(recent).toHaveLength(0);
  });

  it("readRecent filters by level", async () => {
    await logger.log("info", "push", "ok");
    await logger.log("error", "push", "failed");
    await logger.log("info", "pull", "ok");
    const errors = await logger.readRecent(10, { level: "error" });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("failed");
  });

  it("readRecent filters by operation", async () => {
    await logger.log("info", "push", "ok");
    await logger.log("info", "pull", "ok");
    const pulls = await logger.readRecent(10, { operation: "pull" });
    expect(pulls).toHaveLength(1);
    expect(pulls[0].operation).toBe("pull");
  });

  it("survives concurrent writes without corruption", async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      logger.log("info", "push", `concurrent ${i}`),
    );
    await Promise.all(promises);
    const content = await readFile(logFile, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(10);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/logger.test.ts`
Expected: FAIL — module `../src/logger.js` not found

- [ ] **Step 3: Implement Logger**

```typescript
// src/logger.ts
import { appendFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { existsSync } from "node:fs";

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  operation: string;
  message: string;
}

export interface LoggerOptions {
  maxBytes?: number;
  maxFiles?: number;
}

export interface ReadRecentFilter {
  level?: "info" | "warn" | "error";
  operation?: string;
}

export class Logger {
  private filePath: string;
  private maxBytes: number;
  private maxFiles: number;

  constructor(filePath: string, options: LoggerOptions = {}) {
    this.filePath = filePath;
    this.maxBytes = options.maxBytes ?? 512 * 1024; // 512 KB default
    this.maxFiles = options.maxFiles ?? 3;
  }

  async log(level: LogEntry["level"], operation: string, message: string): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      operation,
      message,
    };
    const line = JSON.stringify(entry) + "\n";

    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, line);
    await this.rotateIfNeeded();
  }

  async readRecent(count: number, filter?: ReadRecentFilter): Promise<LogEntry[]> {
    if (!existsSync(this.filePath)) return [];

    let content: string;
    try {
      content = await readFile(this.filePath, "utf-8");
    } catch {
      return [];
    }

    let entries: LogEntry[] = content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as LogEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is LogEntry => e !== null);

    if (filter?.level) {
      entries = entries.filter((e) => e.level === filter.level);
    }
    if (filter?.operation) {
      entries = entries.filter((e) => e.operation === filter.operation);
    }

    return entries.slice(-count);
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const stats = await stat(this.filePath);
      if (stats.size <= this.maxBytes) return;
    } catch {
      return;
    }

    // Shift existing rotated files: .2 -> .3, .1 -> .2, current -> .1
    for (let i = this.maxFiles; i >= 1; i--) {
      const src = i === 1 ? this.filePath : `${this.filePath}.${i - 1}`;
      const dest = `${this.filePath}.${i}`;
      if (existsSync(src)) {
        if (i === this.maxFiles) {
          await rm(dest, { force: true });
        }
        await rename(src, dest);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/logger.test.ts`
Expected: all PASS

- [ ] **Step 5: Run lint + format**

Run: `npm run lint && npm run format`

- [ ] **Step 6: Commit**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "feat: add file-based Logger with rotation and readRecent"
```

---

## Chunk 2: Lockfile

### Task 2: Lockfile — tests and implementation

**Files:**
- Create: `src/lockfile.ts`
- Create: `tests/lockfile.test.ts`

- [ ] **Step 1: Write failing tests for Lockfile**

```typescript
// tests/lockfile.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Lockfile } from "../src/lockfile.js";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

describe("Lockfile", () => {
  let lockDir: string;
  let lockPath: string;

  beforeEach(async () => {
    lockDir = await mkdtemp(join(tmpdir(), "claudefy-lock-test-"));
    lockPath = join(lockDir, "sync.lock");
  });

  afterEach(async () => {
    await rm(lockDir, { recursive: true, force: true });
  });

  it("acquires lock when no lockfile exists", async () => {
    const lock = new Lockfile(lockPath);
    const acquired = await lock.acquire();
    expect(acquired).toBe(true);
    expect(existsSync(lockPath)).toBe(true);
  });

  it("lockfile contains pid and timestamp", async () => {
    const lock = new Lockfile(lockPath);
    await lock.acquire();
    const content = JSON.parse(await readFile(lockPath, "utf-8"));
    expect(content.pid).toBe(process.pid);
    expect(content.timestamp).toBeDefined();
    expect(content.operation).toBeDefined();
  });

  it("releases lock by removing lockfile", async () => {
    const lock = new Lockfile(lockPath);
    await lock.acquire();
    await lock.release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it("fails to acquire when lock held by current process", async () => {
    const lock1 = new Lockfile(lockPath);
    await lock1.acquire();
    const lock2 = new Lockfile(lockPath, { retries: 0 });
    const acquired = await lock2.acquire();
    // Same PID — can't double-lock
    expect(acquired).toBe(false);
    await lock1.release();
  });

  it("detects and removes stale lock from dead PID", async () => {
    // Write a lockfile with a fake PID that doesn't exist
    await writeFile(
      lockPath,
      JSON.stringify({ pid: 999999999, timestamp: new Date().toISOString(), operation: "push" }),
    );
    const lock = new Lockfile(lockPath);
    const acquired = await lock.acquire();
    expect(acquired).toBe(true);
  });

  it("detects and removes stale lock older than maxAge", async () => {
    const oldTime = new Date(Date.now() - 120_000).toISOString();
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, timestamp: oldTime, operation: "push" }),
    );
    const lock = new Lockfile(lockPath, { maxAgeMs: 60_000 });
    const acquired = await lock.acquire();
    expect(acquired).toBe(true);
  });

  it("retries and succeeds when lock is released", async () => {
    const lock1 = new Lockfile(lockPath);
    await lock1.acquire();

    // Release after a short delay
    setTimeout(() => lock1.release(), 200);

    const lock2 = new Lockfile(lockPath, { retries: 5, retryDelayMs: 100 });
    const acquired = await lock2.acquire();
    expect(acquired).toBe(true);
    await lock2.release();
  });

  it("gives up after max retries", async () => {
    // Write lock with current PID to simulate held lock
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString(), operation: "push" }),
    );
    const lock = new Lockfile(lockPath, { retries: 2, retryDelayMs: 50, maxAgeMs: 300_000 });
    const acquired = await lock.acquire();
    expect(acquired).toBe(false);
  });

  it("release is idempotent", async () => {
    const lock = new Lockfile(lockPath);
    await lock.acquire();
    await lock.release();
    await lock.release(); // Should not throw
    expect(existsSync(lockPath)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lockfile.test.ts`
Expected: FAIL — module `../src/lockfile.js` not found

- [ ] **Step 3: Implement Lockfile**

```typescript
// src/lockfile.ts
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { existsSync } from "node:fs";

interface LockData {
  pid: number;
  timestamp: string;
  operation: string;
}

export interface LockfileOptions {
  retries?: number;
  retryDelayMs?: number;
  maxAgeMs?: number;
}

export class Lockfile {
  private path: string;
  private retries: number;
  private retryDelayMs: number;
  private maxAgeMs: number;
  private operation: string;

  constructor(path: string, options: LockfileOptions & { operation?: string } = {}) {
    this.path = path;
    this.retries = options.retries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.maxAgeMs = options.maxAgeMs ?? 120_000; // 2 minutes
    this.operation = options.operation ?? "unknown";
  }

  async acquire(): Promise<boolean> {
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        await this.delay(this.retryDelayMs);
      }

      if (await this.tryAcquire()) {
        return true;
      }
    }
    return false;
  }

  async release(): Promise<void> {
    try {
      await rm(this.path, { force: true });
    } catch {
      // Best effort
    }
  }

  private async tryAcquire(): Promise<boolean> {
    if (!existsSync(this.path)) {
      return this.writeLock();
    }

    // Lock exists — check if stale
    const existing = await this.readLock();
    if (!existing) {
      // Corrupted lockfile, overwrite
      return this.writeLock();
    }

    // Check age
    const age = Date.now() - new Date(existing.timestamp).getTime();
    if (age > this.maxAgeMs) {
      await this.release();
      return this.writeLock();
    }

    // Check if PID is alive
    if (!this.isProcessAlive(existing.pid)) {
      await this.release();
      return this.writeLock();
    }

    // Lock is held by a live, recent process
    return false;
  }

  private async writeLock(): Promise<boolean> {
    try {
      await mkdir(dirname(this.path), { recursive: true });
      const data: LockData = {
        pid: process.pid,
        timestamp: new Date().toISOString(),
        operation: this.operation,
      };
      await writeFile(this.path, JSON.stringify(data), { flag: "wx" });
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        return false;
      }
      // Retry on unexpected error — if the file was created in the meantime
      // by another process, we'll detect it on the next attempt
      return false;
    }
  }

  private async readLock(): Promise<LockData | null> {
    try {
      const content = await readFile(this.path, "utf-8");
      return JSON.parse(content) as LockData;
    } catch {
      return null;
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lockfile.test.ts`
Expected: all PASS

- [ ] **Step 5: Run lint + format**

Run: `npm run lint && npm run format`

- [ ] **Step 6: Commit**

```bash
git add src/lockfile.ts tests/lockfile.test.ts
git commit -m "feat: add Lockfile with retry, staleness detection, and PID checking"
```

---

## Chunk 3: Integrate into Push and Pull commands

### Task 3: Push command — add logger + lockfile

**Files:**
- Modify: `src/commands/push.ts`

The key changes:
1. Accept a `Logger` instance (created by CLI) and log every significant event
2. Acquire lockfile before starting, release on completion
3. The silent `catch {}` at line 59-67 now logs the warning
4. All `if (!options.quiet)` console output stays — but every event also logs to file regardless of `--quiet`

- [ ] **Step 1: Update PushOptions and constructor**

Add `logger` and `lockPath` to PushOptions. At the top of `execute()`, acquire the lock. If lock fails, log + return instead of silently skipping.

```typescript
// In PushOptions, add:
export interface PushOptions {
  quiet: boolean;
  skipEncryption?: boolean;
  skipSecretScan?: boolean;
  passphrase?: string;
  logger?: Logger;    // NEW
}
```

- [ ] **Step 2: Wrap execute() with lock and logging**

At the start of `execute()`:
```typescript
const claudefyDir = join(this.homeDir, ".claudefy");
const lockPath = join(claudefyDir, "sync.lock");
const lockfile = new Lockfile(lockPath, { operation: "push", retries: 3, retryDelayMs: 1000 });
const log = options.logger;

await log?.log("info", "push", "Push started");

const acquired = await lockfile.acquire();
if (!acquired) {
  const msg = "Another claudefy process is running. Push skipped after retries.";
  await log?.log("warn", "push", msg);
  if (!options.quiet) output.warn(msg);
  return;
}

try {
  // ... existing execute body ...
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  await log?.log("error", "push", msg);
  throw err;
} finally {
  await lockfile.release();
}
```

- [ ] **Step 3: Replace silent catch in pullAndMergeMain**

Change lines 59-67 from:
```typescript
try {
  await gitAdapter.pullAndMergeMain();
} catch {
  if (!options.quiet) {
    output.info("Warning: Unable to pull ...");
  }
}
```
To:
```typescript
try {
  await gitAdapter.pullAndMergeMain();
} catch (err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  const msg = `Unable to pull latest changes from remote; proceeding with local state only. Detail: ${detail}`;
  await log?.log("warn", "push", msg);
  if (!options.quiet) {
    output.info(msg);
  }
}
```

- [ ] **Step 4: Add log calls at key milestones**

After classification (line 46-53):
```typescript
await log?.log("info", "push", `Classified: ${classification.allowlist.length} allowed, ${classification.unknown.length} unknown, ${classification.denylist.length} denied`);
```

After encryption (line 156-158):
```typescript
await log?.log("info", "push", `Encrypted ${filesToEncrypt.size} file(s)`);
```

After commitAndPush result (line 167-182):
```typescript
if (commitResult.committed && !commitResult.pushed) {
  await log?.log("warn", "push", "Changes committed locally but push to remote failed");
}
if (commitResult.pushed && !commitResult.mergedToMain) {
  await log?.log("warn", "push", "Pushed but merge to main failed — may need conflict resolution");
}
await log?.log("info", "push", `Push complete. committed=${commitResult.committed} pushed=${commitResult.pushed}`);
```

- [ ] **Step 5: Run existing push tests to verify no regressions**

Run: `npx vitest run tests/commands/push.test.ts`
Expected: all existing tests PASS (logger is optional, lockfile is file-based)

- [ ] **Step 6: Commit**

```bash
git add src/commands/push.ts
git commit -m "feat: integrate logger and lockfile into PushCommand"
```

### Task 4: Pull command — add logger + lockfile

**Files:**
- Modify: `src/commands/pull.ts`

Same pattern as push. Key changes:
1. Add `logger` to `PullOptions`
2. Acquire lock, log on failure
3. Fix the silent `catch {}` at lines 47-51
4. Log at every significant milestone

- [ ] **Step 1: Update PullOptions**

```typescript
export interface PullOptions {
  quiet: boolean;
  skipEncryption?: boolean;
  passphrase?: string;
  logger?: Logger;    // NEW
}
```

- [ ] **Step 2: Wrap execute() with lock and logging**

At the start of `execute()`, after loading config:
```typescript
const lockPath = join(claudefyDir, "sync.lock");
const lockfile = new Lockfile(lockPath, { operation: "pull", retries: 3, retryDelayMs: 1000 });
const log = options.logger;

await log?.log("info", "pull", "Pull started");

const acquired = await lockfile.acquire();
if (!acquired) {
  const msg = "Another claudefy process is running. Pull skipped after retries.";
  await log?.log("warn", "pull", msg);
  if (!options.quiet) output.warn(msg);
  return result;
}
```

Wrap the rest in `try/catch/finally` with `lockfile.release()` in `finally`.

- [ ] **Step 3: Fix the silent catch at pullAndMergeMain**

Change lines 47-51 from:
```typescript
try {
  await gitAdapter.pullAndMergeMain();
} catch {
  // Fresh store with no remote history yet
}
```
To:
```typescript
try {
  await gitAdapter.pullAndMergeMain();
} catch (err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  await log?.log("warn", "pull", `Unable to pull from remote (may be fresh store): ${detail}`);
}
```

- [ ] **Step 4: Add log calls at key milestones**

Override detected:
```typescript
await log?.log("warn", "pull", `Override detected from machine: ${override.machine} at ${override.timestamp}`);
```

After backup:
```typescript
await log?.log("info", "pull", `Backup created at: ${result.backupPath}`);
```

After completion:
```typescript
await log?.log("info", "pull", `Pull complete. ${result.filesUpdated} items updated. override=${result.overrideDetected}`);
```

Catch at top level:
```typescript
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  await log?.log("error", "pull", msg);
  throw err;
} finally {
  await lockfile.release();
}
```

- [ ] **Step 5: Run existing pull tests to verify no regressions**

Run: `npx vitest run tests/commands/pull.test.ts`
Expected: all existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/commands/pull.ts
git commit -m "feat: integrate logger and lockfile into PullCommand"
```

---

## Chunk 4: CLI wiring and Doctor enhancement

### Task 5: Wire Logger in CLI + add `logs` command

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Create logger instance in CLI and pass to push/pull**

In `cli.ts`, create a shared logger and pass it through options:

```typescript
import { Logger } from "./logger.js";

// At top level, after homeDir:
const syncLogger = new Logger(join(homeDir, ".claudefy", "logs", "sync.log"));
```

In the push action handler, add `logger: syncLogger` to the options passed to `cmd.execute()`.
In the pull action handler, add `logger: syncLogger` to the options passed to `cmd.execute()`.

- [ ] **Step 2: Add `claudefy logs` command**

```typescript
program
  .command("logs")
  .description("Show recent sync log entries")
  .option("-n, --count <number>", "Number of entries to show", "20")
  .option("--errors", "Show only errors")
  .option("--operation <op>", "Filter by operation (push/pull)")
  .action(async (options) => {
    const filter: { level?: "error"; operation?: string } = {};
    if (options.errors) filter.level = "error";
    if (options.operation) filter.operation = options.operation;
    const entries = await syncLogger.readRecent(parseInt(options.count, 10), filter);
    if (entries.length === 0) {
      output.dim("No log entries found.");
      return;
    }
    for (const entry of entries) {
      const time = entry.timestamp.replace("T", " ").replace(/\.\d+Z$/, "Z");
      const levelColor =
        entry.level === "error" ? chalk.red(entry.level.toUpperCase()) :
        entry.level === "warn" ? chalk.yellow(entry.level.toUpperCase()) :
        chalk.blue(entry.level.toUpperCase());
      console.log(`${chalk.dim(time)} ${levelColor} [${entry.operation}] ${entry.message}`);
    }
  });
```

Import `chalk` at the top if not already imported (it is — `output.ts` uses it, but `cli.ts` doesn't import it directly). Add `import chalk from "chalk";` to `cli.ts`.

- [ ] **Step 3: Run build to verify compilation**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: wire Logger into CLI, add 'claudefy logs' command"
```

### Task 6: Enhance Doctor with recent-sync check

**Files:**
- Modify: `src/commands/doctor.ts`
- Modify: `tests/commands/doctor.test.ts`

- [ ] **Step 1: Write failing test for recent-sync check**

Add to `tests/commands/doctor.test.ts`:

```typescript
it("reports recent-sync pass when log has no errors", async () => {
  const claudefyDir = join(homeDir, ".claudefy");
  await mkdir(join(claudefyDir, "logs"), { recursive: true });
  await writeFile(
    join(claudefyDir, "config.json"),
    JSON.stringify({
      version: 1,
      backend: { type: "git", url: "https://example.com/repo.git" },
      encryption: { enabled: false, useKeychain: false, cacheDuration: "0" },
      sync: { lfsThreshold: 524288 },
      filter: {},
      machineId: "test-machine",
    }),
  );
  // Write a success log entry
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    operation: "push",
    message: "Push complete",
  });
  await writeFile(join(claudefyDir, "logs", "sync.log"), entry + "\n");

  const cmd = new DoctorCommand(homeDir);
  const checks = await cmd.execute();
  const syncCheck = checks.find((c) => c.name === "recent-sync");
  expect(syncCheck).toBeDefined();
  expect(syncCheck!.status).toBe("pass");
});

it("reports recent-sync warn when log has recent errors", async () => {
  const claudefyDir = join(homeDir, ".claudefy");
  await mkdir(join(claudefyDir, "logs"), { recursive: true });
  await writeFile(
    join(claudefyDir, "config.json"),
    JSON.stringify({
      version: 1,
      backend: { type: "git", url: "https://example.com/repo.git" },
      encryption: { enabled: false, useKeychain: false, cacheDuration: "0" },
      sync: { lfsThreshold: 524288 },
      filter: {},
      machineId: "test-machine",
    }),
  );
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "error",
    operation: "push",
    message: "Push failed: network error",
  });
  await writeFile(join(claudefyDir, "logs", "sync.log"), entry + "\n");

  const cmd = new DoctorCommand(homeDir);
  const checks = await cmd.execute();
  const syncCheck = checks.find((c) => c.name === "recent-sync");
  expect(syncCheck).toBeDefined();
  expect(syncCheck!.status).toBe("warn");
  expect(syncCheck!.detail).toContain("error");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/doctor.test.ts`
Expected: FAIL — no `recent-sync` check in results

- [ ] **Step 3: Implement recent-sync check in DoctorCommand**

Add to `doctor.ts`:

```typescript
import { Logger } from "../logger.js";

// In execute(), after existing checks:
checks.push(await this.checkRecentSync());

// New method:
private async checkRecentSync(): Promise<DoctorCheck> {
  const logPath = join(this.homeDir, ".claudefy", "logs", "sync.log");
  const logger = new Logger(logPath);
  const recent = await logger.readRecent(20);

  if (recent.length === 0) {
    return { name: "recent-sync", status: "warn", detail: "No sync log entries found. Hooks may not be running." };
  }

  const errors = recent.filter((e) => e.level === "error");
  const warns = recent.filter((e) => e.level === "warn" && e.message.includes("skipped"));

  if (errors.length > 0) {
    const latest = errors[errors.length - 1];
    return { name: "recent-sync", status: "warn", detail: `${errors.length} error(s) in recent syncs. Latest: ${latest.message}` };
  }

  if (warns.length > 0) {
    return { name: "recent-sync", status: "warn", detail: `${warns.length} skipped sync(s) in recent log (lock contention?)` };
  }

  const latest = recent[recent.length - 1];
  return { name: "recent-sync", status: "pass", detail: `Last sync: ${latest.timestamp} (${latest.operation})` };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/commands/doctor.test.ts`
Expected: all PASS

- [ ] **Step 5: Run full test suite**

Run: `npm run lint && npm run format:check && npm run build && npm run test`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/commands/doctor.ts tests/commands/doctor.test.ts
git commit -m "feat: add recent-sync health check to doctor command"
```

---

## Summary of changes

| What | Why |
|------|-----|
| `src/logger.ts` | Persistent structured log to `~/.claudefy/logs/sync.log` with rotation |
| `src/lockfile.ts` | Process-level mutual exclusion with PID check, staleness, retry |
| Push/Pull integration | Every significant event logged to file; lock acquired before mutation |
| Silent catches fixed | `pullAndMergeMain` catch blocks now log error detail instead of swallowing |
| `claudefy logs` | Quick CLI access to recent sync log entries with filtering |
| `claudefy doctor` | New `recent-sync` check reads log for errors/skips |
| `--quiet` behavior | Console output suppressed, file logging always active |
