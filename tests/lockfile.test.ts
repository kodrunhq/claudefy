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
