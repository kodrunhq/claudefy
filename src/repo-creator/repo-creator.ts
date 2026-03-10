import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RepoProvider = "github" | "gitlab";

export class RepoCreator {
  async detect(): Promise<RepoProvider | null> {
    if (await this.isAvailable("gh")) return "github";
    if (await this.isAvailable("glab")) return "gitlab";
    return null;
  }

  async create(name: string, provider?: RepoProvider): Promise<string> {
    const detected = provider || (await this.detect());
    if (!detected) {
      throw new Error("No supported CLI found. Install 'gh' (GitHub) or 'glab' (GitLab).");
    }

    if (detected === "github") {
      const { stdout } = await execFileAsync("gh", ["repo", "create", name, "--private", "--yes"]);
      // gh repo create outputs the URL
      const url = stdout.trim().split("\n").pop()?.trim();
      if (!url) throw new Error("Failed to parse repo URL from gh output");
      return url;
    }

    if (detected === "gitlab") {
      const { stdout } = await execFileAsync("glab", [
        "project",
        "create",
        "--name",
        name,
        "--visibility",
        "private",
      ]);
      const urlMatch = stdout.match(/https?:\/\/\S+/);
      if (!urlMatch) throw new Error("Failed to parse repo URL from glab output");
      return urlMatch[0];
    }

    throw new Error(`Unsupported provider: ${detected}`);
  }

  private async isAvailable(cmd: string): Promise<boolean> {
    try {
      const whichCmd = process.platform === "win32" ? "where" : "which";
      await execFileAsync(whichCmd, [cmd]);
      return true;
    } catch {
      return false;
    }
  }
}
