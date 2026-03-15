import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Lockfile, withLock } from "../../src/lockfile/lockfile.js";

describe("Lockfile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-lockfile-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("acquires lock when no lock exists", () => {
    const lock = Lockfile.tryAcquire("push", false, tempDir);
    expect(lock).not.toBeNull();
    expect(existsSync(join(tempDir, ".lock"))).toBe(true);
    lock!.release();
  });

  it("releases lock by deleting lock file", () => {
    const lock = Lockfile.tryAcquire("push", false, tempDir);
    expect(lock).not.toBeNull();
    lock!.release();
    expect(existsSync(join(tempDir, ".lock"))).toBe(false);
  });

  it("allows re-entrant lock from the same PID", () => {
    const lock1 = Lockfile.tryAcquire("push", false, tempDir);
    expect(lock1).not.toBeNull();

    const lock2 = Lockfile.tryAcquire("pull", true, tempDir);
    expect(lock2).not.toBeNull();

    // Re-entrant release should not delete the lock file
    lock2!.release();
    expect(existsSync(join(tempDir, ".lock"))).toBe(true);

    // Original release should delete the lock file
    lock1!.release();
    expect(existsSync(join(tempDir, ".lock"))).toBe(false);
  });

  it("returns null when another live PID holds the lock", () => {
    // Simulate a lock held by a different PID (use parent PID which is guaranteed alive and different)
    const otherPid = process.ppid;
    const lockPath = join(tempDir, ".lock");
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: otherPid, command: "push", startedAt: new Date().toISOString() }),
    );

    const lock = Lockfile.tryAcquire("pull", true, tempDir);
    expect(lock).toBeNull();
  });

  it("cleans stale lock from dead PID and re-acquires", () => {
    const lockPath = join(tempDir, ".lock");
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999999999, command: "push", startedAt: new Date().toISOString() }),
    );

    const lock = Lockfile.tryAcquire("pull", false, tempDir);
    expect(lock).not.toBeNull();
    lock!.release();
  });

  it("cleans expired lock older than max age", () => {
    const lockPath = join(tempDir, ".lock");
    const expiredDate = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, command: "push", startedAt: expiredDate }),
    );

    const lock = Lockfile.tryAcquire("pull", false, tempDir);
    expect(lock).not.toBeNull();
    lock!.release();
  });

  it("lock file contains correct info", async () => {
    const lock = Lockfile.tryAcquire("push", false, tempDir);
    expect(lock).not.toBeNull();

    const content = JSON.parse(await readFile(join(tempDir, ".lock"), "utf-8"));
    expect(content.pid).toBe(process.pid);
    expect(content.command).toBe("push");
    expect(content.startedAt).toBeDefined();

    lock!.release();
  });
});

describe("withLock", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-withlock-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("releases lock even when fn throws", async () => {
    await expect(
      withLock("push", true, tempDir, async () => {
        throw new Error("simulated failure");
      }),
    ).rejects.toThrow("simulated failure");

    // Lock file must be gone — a subsequent acquire must succeed
    const lock = Lockfile.tryAcquire("pull", true, tempDir);
    expect(lock).not.toBeNull();
    lock!.release();
  });

  it("returns without calling fn when lock is held by another PID", async () => {
    const lockPath = join(tempDir, ".lock");
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.ppid, command: "push", startedAt: new Date().toISOString() }),
    );

    let called = false;
    await withLock("pull", true, tempDir, async () => {
      called = true;
    });
    expect(called).toBe(false);
  });
});
