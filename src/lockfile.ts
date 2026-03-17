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
  private readonly path: string;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly maxAgeMs: number;
  private readonly operation: string;

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
      // Best effort — stale lock will expire via maxAgeMs
    }
  }

  private async tryAcquire(): Promise<boolean> {
    if (!existsSync(this.path)) {
      return this.writeLock();
    }

    // Lock exists — check if stale
    const existing = await this.readLock();
    if (!existing) {
      // Corrupted lockfile (unparseable JSON), overwrite
      await this.release();
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
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const data: LockData = {
      pid: process.pid,
      timestamp: new Date().toISOString(),
      operation: this.operation,
    };
    try {
      await writeFile(this.path, JSON.stringify(data), { flag: "wx", mode: 0o600 });
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        return false;
      }
      throw err; // Disk full, permissions, etc. must surface
    }
  }

  private async readLock(): Promise<LockData | null> {
    try {
      const content = await readFile(this.path, "utf-8");
      return JSON.parse(content) as LockData;
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        return null; // Corrupted JSON
      }
      // I/O errors (EACCES, EMFILE, etc.) — treat as "lock exists, can't read"
      // so we don't steal it. Return a synthetic entry with current PID to prevent overwrite.
      return { pid: process.pid, timestamp: new Date().toISOString(), operation: "unknown" };
    }
  }

  private isProcessAlive(pid: number): boolean {
    // pid=0 signals the process group; pid<0 signals a group or all processes.
    // Neither represents a real process that owns a lock.
    if (!Number.isInteger(pid) || pid <= 0 || pid > 4194304) {
      return false;
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: unknown) {
      // EPERM means the process exists but belongs to another user
      if ((err as NodeJS.ErrnoException).code === "EPERM") {
        return true;
      }
      // ESRCH means process doesn't exist
      return false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
