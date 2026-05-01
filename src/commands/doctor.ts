import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { ConfigManager } from "../config/config-manager.js";
import { Logger } from "../logger.js";
import { redactUrl } from "../output.js";
import { CLAUDEFY_DIR } from "../config/defaults.js";

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
    checks.push(await this.checkBinary("git-lfs", "git lfs version", "warn"));
    checks.push(this.checkInitialized());

    const configManager = new ConfigManager(this.homeDir);
    if (configManager.isInitialized()) {
      const config = await configManager.load();
      checks.push(this.checkEncryption(config));
      checks.push(await this.checkRemote(config.backend.url));
    }

    checks.push(await this.checkRecentSync());

    return checks;
  }

  private async checkBinary(
    name: string,
    command: string,
    failSeverity: "fail" | "warn" = "fail",
  ): Promise<DoctorCheck> {
    const [cmd, ...args] = command.split(" ");
    try {
      const { stdout } = await execFileAsync(cmd, args);
      return { name, status: "pass", detail: stdout.trim().split("\n")[0] };
    } catch {
      return { name, status: failSeverity, detail: `${name} not found in PATH` };
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

  private checkEncryption(config: {
    encryption: { enabled: boolean; mode?: "reactive" | "full" };
  }): DoctorCheck {
    if (config.encryption.enabled) {
      return {
        name: "encryption",
        status: "pass",
        detail: `Enabled (mode: ${config.encryption.mode ?? "reactive"})`,
      };
    }
    return {
      name: "encryption",
      status: "warn",
      detail: "Disabled — files stored in plaintext",
    };
  }

  private async checkRemote(url: string): Promise<DoctorCheck> {
    const safeUrl = redactUrl(url);
    try {
      await execFileAsync("git", ["ls-remote", url], { timeout: 10000 });
      return { name: "remote-reachable", status: "pass", detail: `remote ${safeUrl} is reachable` };
    } catch {
      return {
        name: "remote-reachable",
        status: "fail",
        detail: `Cannot reach remote: ${safeUrl}`,
      };
    }
  }

  private async checkRecentSync(): Promise<DoctorCheck> {
    const logPath = join(this.homeDir, CLAUDEFY_DIR, "logs", "sync.log");
    const logger = new Logger(logPath);
    const recent = await logger.readRecent(20);

    if (recent.length === 0) {
      return {
        name: "recent-sync",
        status: "warn",
        detail: "No sync log entries found. Hooks may not be running.",
      };
    }

    const errors = recent.filter((e) => e.level === "error");
    const warns = recent.filter((e) => e.level === "warn" && e.message.includes("skipped"));

    if (errors.length > 0) {
      const latest = errors[errors.length - 1];
      return {
        name: "recent-sync",
        status: "warn",
        detail: `${errors.length} error(s) in recent syncs. Latest: ${latest.message}`,
      };
    }

    if (warns.length > 0) {
      return {
        name: "recent-sync",
        status: "warn",
        detail: `${warns.length} skipped sync(s) in recent log (lock contention?)`,
      };
    }

    const latest = recent[recent.length - 1];
    return {
      name: "recent-sync",
      status: "pass",
      detail: `Last sync: ${latest.timestamp} (${latest.operation})`,
    };
  }
}
