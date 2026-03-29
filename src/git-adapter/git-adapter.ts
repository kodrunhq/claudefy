import { simpleGit, SimpleGit } from "simple-git";
import { readFile, writeFile, rm, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const LFS_GITATTRIBUTES = [
  "projects/**/*.jsonl filter=lfs diff=lfs merge=lfs -text",
  "projects/**/*.jsonl.age filter=lfs diff=lfs merge=lfs -text",
  "",
].join("\n");

export interface CommitResult {
  committed: boolean;
  pushed: boolean;
  mergedToMain: boolean;
  pushError?: string;
  mergeError?: string;
}

export interface OverrideMarker {
  machine: string;
  timestamp: string;
}

export class GitAdapter {
  private baseDir: string;
  private storePath: string;
  private git: SimpleGit | null = null;
  private ghAuthCache: boolean | null = null;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.storePath = join(baseDir, "store");
  }

  async initStore(remoteUrl: string): Promise<void> {
    if (existsSync(this.storePath)) {
      this.git = simpleGit(this.storePath);
      await this.configureHttpBuffer(this.git);
      await this.configureCredentialHelper(this.git, remoteUrl);
      return;
    }

    const cloneGit = await this.gitWithCredentials(this.baseDir, remoteUrl);

    try {
      await cloneGit.clone(remoteUrl, "store");
    } catch (error) {
      // Check if remote is empty (no refs) — only then initialize locally
      const refs = await cloneGit.listRemote([remoteUrl]).catch(() => "");
      if (refs.trim()) {
        throw new Error(
          `Failed to clone non-empty remote '${remoteUrl}': ${(error as Error).message}`,
          { cause: error },
        );
      }
      await mkdir(this.storePath, { recursive: true });
      const git = simpleGit(this.storePath);
      await git.init(["-b", "main"]);
      await git.addRemote("origin", remoteUrl);
      await this.configureCredentialHelper(git, remoteUrl);
      await writeFile(join(this.storePath, ".gitkeep"), "");
      await git.add(".").commit("initial claudefy store");
      await git.push(["-u", "origin", "main"]);
    }

    this.git = simpleGit(this.storePath);
    await this.configureHttpBuffer(this.git);
    await this.configureCredentialHelper(this.git, remoteUrl);

    // If we cloned an empty repo, it may be on master with no commits — initialize properly
    await this.ensureMainBranch();
  }

  async ensureMachineBranch(machineId: string): Promise<void> {
    this.ensureInitialized();
    const branchName = `machines/${machineId}`;

    // Check if local branch exists
    const localBranches = await this.git!.branchLocal();
    if (localBranches.all.includes(branchName)) {
      await this.git!.checkout(branchName);
      return;
    }

    // Try to fetch from remote
    try {
      await this.git!.fetch("origin", branchName);
      const remoteBranches = await this.git!.branch(["-r"]);
      if (remoteBranches.all.includes(`origin/${branchName}`)) {
        await this.git!.checkout(["-b", branchName, `origin/${branchName}`]);
        return;
      }
    } catch {
      // Remote branch doesn't exist, that's fine
    }

    // Create new local branch from current HEAD
    await this.git!.checkoutLocalBranch(branchName);
  }

  async getCurrentBranch(): Promise<string> {
    this.ensureInitialized();
    const result = await this.git!.revparse(["--abbrev-ref", "HEAD"]);
    return result.trim();
  }

  async commitAndPush(message: string, machineId?: string): Promise<CommitResult> {
    this.ensureInitialized();
    const result: CommitResult = { committed: false, pushed: false, mergedToMain: false };

    await this.git!.add(".");
    const status = await this.git!.status();
    const currentBranch = await this.getCurrentBranch();

    if (status.isClean() && status.ahead === 0) {
      return result;
    }

    if (!status.isClean()) {
      await this.git!.commit(message);
      result.committed = true;
    }

    try {
      await this.git!.push(["-u", "origin", currentBranch]);
      result.pushed = true;
    } catch (err) {
      result.pushed = false;
      result.pushError = (err as Error).message;
      return result;
    }

    if (machineId) {
      const machineBranch = `machines/${machineId}`;
      try {
        await this.git!.checkout("main");
        await this.git!.pull("origin", "main").catch(() => {});
        await this.git!.merge([machineBranch]);
        await this.git!.push(["-u", "origin", "main"]);
        result.mergedToMain = true;
      } catch (err) {
        result.mergedToMain = false;
        result.mergeError = (err as Error).message;
        // Abort any in-progress merge
        await this.git!.merge(["--abort"]).catch(() => {});
      } finally {
        await this.git!.checkout(machineBranch);
      }
    }

    return result;
  }

  async isClean(): Promise<boolean> {
    this.ensureInitialized();
    await this.git!.add(".");
    const status = await this.git!.status();
    return status.isClean();
  }

  async pull(): Promise<void> {
    this.ensureInitialized();
    await this.git!.pull();
  }

  async pullAndMergeMain(): Promise<void> {
    this.ensureInitialized();
    const currentBranch = await this.getCurrentBranch();

    await this.git!.fetch("origin");

    // Checkout main and reset to remote (handles force-pushed overrides)
    await this.git!.checkout("main");
    await this.git!.reset(["--hard", "origin/main"]);

    // Go back to machine branch and merge main into it
    await this.git!.checkout(currentBranch);
    try {
      await this.git!.merge(["main"]);
    } catch {
      // Merge conflict — abort, machine branch state wins
      await this.git!.merge(["--abort"]).catch(() => {});
    }
  }

  async writeOverrideMarker(machineId: string): Promise<void> {
    this.ensureInitialized();
    const marker: OverrideMarker = {
      machine: machineId,
      timestamp: new Date().toISOString(),
    };
    await writeFile(join(this.storePath, ".override"), JSON.stringify(marker, null, 2));
  }

  async checkOverrideMarker(): Promise<OverrideMarker | null> {
    this.ensureInitialized();
    const path = join(this.storePath, ".override");
    if (!existsSync(path)) return null;
    const content = await readFile(path, "utf-8");
    try {
      return JSON.parse(content) as OverrideMarker;
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async removeOverrideMarker(): Promise<void> {
    this.ensureInitialized();
    const path = join(this.storePath, ".override");
    if (existsSync(path)) {
      await rm(path);
    }
  }

  async wipeAndPush(machineId: string): Promise<void> {
    this.ensureInitialized();
    const currentBranch = await this.getCurrentBranch();
    const entries = await readdir(this.storePath);
    for (const entry of entries) {
      if (entry === ".git" || entry === ".gitattributes") continue;
      await rm(join(this.storePath, entry), { recursive: true, force: true });
    }
    await this.writeOverrideMarker(machineId);
    await this.git!.add(".");
    await this.git!.commit(`override: ${machineId} at ${new Date().toISOString()}`);
    await this.git!.push(["-u", "origin", currentBranch, "--force"]);

    // If on a machine branch, also force-update main
    if (currentBranch.startsWith("machines/")) {
      await this.git!.checkout("main");
      await this.git!.reset(["--hard", currentBranch]);
      await this.git!.push(["--force", "-u", "origin", "main"]);
      await this.git!.checkout(currentBranch);
    }
  }

  async ensureGitattributes(): Promise<void> {
    const path = join(this.storePath, ".gitattributes");
    if (!existsSync(path)) {
      await writeFile(path, LFS_GITATTRIBUTES);
    }
  }

  getStorePath(): string {
    return this.storePath;
  }

  private async ensureMainBranch(): Promise<void> {
    if (!this.git) return;
    // Check if repo has any commits (empty clone scenario)
    const hasCommits = await this.git
      .revparse(["HEAD"])
      .then(() => true)
      .catch(() => false);
    if (!hasCommits) {
      // Empty cloned repo — create initial commit on main branch
      // First, checkout -b main (we may be on master from clone default)
      await this.git.checkout(["-b", "main"]).catch(() => {});
      await writeFile(join(this.storePath, ".gitkeep"), "");
      await this.git.add(".");
      await this.git.commit("initial claudefy store");
      await this.git.push(["-u", "origin", "main"]).catch(() => {});
      // Update remote HEAD to point to main
      await this.git.remote(["set-head", "origin", "main"]).catch(() => {});
    }
  }

  private ensureInitialized(): void {
    if (!this.git) {
      throw new Error("GitAdapter not initialized. Call initStore() first.");
    }
  }

  private async configureHttpBuffer(git: SimpleGit): Promise<void> {
    try {
      await git.addConfig("http.postBuffer", "524288000");
    } catch {
      // Best-effort — git will use default buffer if this fails
    }
  }

  private async configureCredentialHelper(git: SimpleGit, remoteUrl: string): Promise<void> {
    if (!this.isGitHubHttps(remoteUrl)) return;
    if (!(await this.isGhAuthenticated())) return;
    try {
      await git.addConfig("credential.helper", "!gh auth git-credential");
    } catch {
      // Best-effort — if it fails, git will fall back to default credential prompts
    }
  }

  private async gitWithCredentials(baseDir: string, remoteUrl: string): Promise<SimpleGit> {
    if (this.isGitHubHttps(remoteUrl) && (await this.isGhAuthenticated())) {
      return simpleGit(baseDir, {
        config: ["credential.helper=!gh auth git-credential"],
      });
    }
    return simpleGit(baseDir);
  }

  private isGitHubHttps(url: string): boolean {
    try {
      return new URL(url).hostname === "github.com";
    } catch {
      return false;
    }
  }

  private async isGhAuthenticated(): Promise<boolean> {
    if (this.ghAuthCache !== null) return this.ghAuthCache;
    try {
      await execFileAsync("gh", ["auth", "status"]);
      this.ghAuthCache = true;
    } catch {
      this.ghAuthCache = false;
    }
    return this.ghAuthCache;
  }
}
