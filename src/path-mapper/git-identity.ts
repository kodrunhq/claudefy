import { simpleGit } from "simple-git";

export interface GitIdentityResult {
  canonicalId: string;
  gitRemote: string;
}

export class GitIdentity {
  async detect(dirPath: string): Promise<GitIdentityResult | null> {
    try {
      const git = simpleGit(dirPath);
      const isRepo = await git.checkIsRepo();
      if (!isRepo) return null;

      const remotes = await git.getRemotes(true);
      const origin = remotes.find((r) => r.name === "origin");
      if (!origin?.refs?.fetch) return null;

      const remoteUrl = origin.refs.fetch;
      const canonicalId = this.urlToCanonicalId(remoteUrl);

      return { canonicalId, gitRemote: remoteUrl };
    } catch {
      return null;
    }
  }

  urlToCanonicalId(url: string): string {
    let normalized = url.toLowerCase();
    normalized = normalized.replace(/\.git$/, "");

    const sshMatch = normalized.match(/^git@([^:]+):(.+)$/);
    if (sshMatch) {
      return `${sshMatch[1]}--${sshMatch[2].replace(/\//g, "--")}`;
    }

    const httpsMatch = normalized.match(/^https?:\/\/([^/]+)\/(.+)$/);
    if (httpsMatch) {
      return `${httpsMatch[1]}--${httpsMatch[2].replace(/\//g, "--")}`;
    }

    return normalized.replace(/[/:@]/g, "--");
  }
}
