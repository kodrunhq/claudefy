import { join } from "node:path";
import { ConfigManager } from "../config/config-manager.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { output } from "../output.js";

export interface LogsOptions {
  count?: number;
  quiet?: boolean;
}

export class LogsCommand {
  private readonly homeDir: string;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
  }

  async execute(options: LogsOptions): Promise<void> {
    const configManager = new ConfigManager(this.homeDir);
    const config = await configManager.load();
    const gitAdapter = new GitAdapter(join(this.homeDir, ".claudefy"));
    await gitAdapter.initStore(config.backend.url);

    const { simpleGit } = await import("simple-git");
    const git = simpleGit(gitAdapter.getStorePath());
    const log = await git.log({ maxCount: options.count ?? 10 });

    if (log.all.length === 0) {
      if (!options.quiet) output.info("No sync history found.");
      return;
    }

    if (!options.quiet) {
      output.heading("Recent sync operations");
      for (const entry of log.all) {
        const date = new Date(entry.date).toISOString().replace("T", " ").slice(0, 16);
        output.info(`${date}  ${entry.message}`);
      }
    }
  }
}
