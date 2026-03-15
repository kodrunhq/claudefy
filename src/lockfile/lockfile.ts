import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { output } from "../output.js";

interface LockInfo {
  pid: number;
  command: string;
  startedAt: string;
}

const MAX_LOCK_AGE_MS = 10 * 60 * 1000; // 10 minutes

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class Lockfile {
  private readonly lockPath: string;
  private readonly reentrant: boolean;

  private constructor(lockPath: string, reentrant = false) {
    this.lockPath = lockPath;
    this.reentrant = reentrant;
  }

  static tryAcquire(command: string, quiet: boolean, claudefyDir: string): Lockfile | null {
    const lockPath = join(claudefyDir, ".lock");

    if (existsSync(lockPath)) {
      try {
        const raw = readFileSync(lockPath, "utf-8");
        const info: LockInfo = JSON.parse(raw);
        const age = Date.now() - new Date(info.startedAt).getTime();

        if (isPidAlive(info.pid) && age < MAX_LOCK_AGE_MS) {
          if (info.pid === process.pid) {
            // Re-entrant: same process already holds the lock
            return new Lockfile(lockPath, true);
          }
          if (!quiet) {
            output.info(
              `Another claudefy operation is in progress (PID ${info.pid}, ${info.command}). Skipping.`,
            );
          }
          return null;
        }

        unlinkSync(lockPath);
      } catch {
        try {
          unlinkSync(lockPath);
        } catch {
          // Already gone
        }
      }
    }

    const lockInfo: LockInfo = {
      pid: process.pid,
      command,
      startedAt: new Date().toISOString(),
    };

    try {
      mkdirSync(claudefyDir, { recursive: true });
      writeFileSync(lockPath, JSON.stringify(lockInfo), { flag: "wx" });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        if (!quiet) {
          output.info("Another claudefy operation just started. Skipping.");
        }
        return null;
      }
      throw err;
    }

    return new Lockfile(lockPath);
  }

  release(): void {
    if (this.reentrant) return;
    try {
      unlinkSync(this.lockPath);
    } catch {
      // Already removed
    }
  }
}

export async function withLock(
  command: string,
  quiet: boolean,
  claudefyDir: string,
  fn: () => Promise<void>,
): Promise<void> {
  const lock = Lockfile.tryAcquire(command, quiet, claudefyDir);
  if (!lock) return;
  try {
    await fn();
  } finally {
    lock.release();
  }
}
