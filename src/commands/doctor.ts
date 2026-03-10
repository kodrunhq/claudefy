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
    return {
      name: "encryption",
      status: "warn",
      detail: "encryption disabled — files pushed in cleartext",
    };
  }

  private async checkRemote(url: string): Promise<DoctorCheck> {
    try {
      await execFileAsync("git", ["ls-remote", url], { timeout: 10000 });
      return { name: "remote-reachable", status: "pass", detail: `remote ${url} is reachable` };
    } catch {
      return { name: "remote-reachable", status: "fail", detail: `Cannot reach remote: ${url}` };
    }
  }
}
