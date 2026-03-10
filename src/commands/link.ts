import { ConfigManager } from "../config/config-manager.js";
import { GitIdentity } from "../path-mapper/git-identity.js";

export class LinkCommand {
  private homeDir: string;
  private configManager: ConfigManager;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
    this.configManager = new ConfigManager(homeDir);
  }

  async add(alias: string, localPath: string): Promise<void> {
    const identity = new GitIdentity();
    const result = await identity.detect(localPath);

    await this.configManager.addLink(alias, localPath, {
      canonicalId: result?.canonicalId || alias,
      gitRemote: result?.gitRemote || null,
    });
  }

  async remove(alias: string): Promise<void> {
    await this.configManager.removeLink(alias);
  }

  async list(): Promise<
    Record<string, { localPath: string; canonicalId: string; gitRemote: string | null }>
  > {
    const links = await this.configManager.getLinks();
    const result: Record<
      string,
      { localPath: string; canonicalId: string; gitRemote: string | null }
    > = {};
    for (const [alias, entry] of Object.entries(links)) {
      result[alias] = {
        localPath: entry.localPath,
        canonicalId: entry.canonicalId,
        gitRemote: entry.gitRemote,
      };
    }
    return result;
  }
}
