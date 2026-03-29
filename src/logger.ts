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

function isLogEntry(value: unknown): value is LogEntry {
  if (value === null || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e["timestamp"] === "string" &&
    typeof e["level"] === "string" &&
    (e["level"] === "info" || e["level"] === "warn" || e["level"] === "error") &&
    typeof e["operation"] === "string" &&
    typeof e["message"] === "string"
  );
}

export class Logger {
  private readonly filePath: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;

  constructor(filePath: string, options: LoggerOptions = {}) {
    this.filePath = filePath;
    this.maxBytes = options.maxBytes ?? 512 * 1024; // 512 KB default
    this.maxFiles = options.maxFiles ?? 3;
  }

  async log(level: LogEntry["level"], operation: string, message: string): Promise<void> {
    try {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        operation,
        message,
      };
      const line = JSON.stringify(entry) + "\n";

      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      await appendFile(this.filePath, line, { mode: 0o600 });
      await this.rotateIfNeeded();
    } catch {
      // Logging is best-effort; never crash the caller
    }
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
          const parsed: unknown = JSON.parse(line);
          if (!isLogEntry(parsed)) return null;
          return parsed;
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
