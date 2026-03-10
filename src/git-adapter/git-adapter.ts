import { simpleGit, SimpleGit } from "simple-git";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface OverrideMarker {
  machine: string;
  timestamp: string;
}

export class GitAdapter {
  private baseDir: string;
  private storePath: string;
  private git: SimpleGit | null = null;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.storePath = join(baseDir, "store");
  }

  async initStore(remoteUrl: string): Promise<void> {
    if (existsSync(this.storePath)) {
      this.git = simpleGit(this.storePath);
      return;
    }

    try {
      await simpleGit(this.baseDir).clone(remoteUrl, "store");
    } catch (error) {
      // Check if remote is empty (no refs) — only then initialize locally
      const refs = await simpleGit(this.baseDir)
        .listRemote([remoteUrl])
        .catch(() => "");
      if (refs.trim()) {
        throw new Error(
          `Failed to clone non-empty remote '${remoteUrl}': ${(error as Error).message}`,
          { cause: error },
        );
      }
      await mkdir(this.storePath, { recursive: true });
      const git = simpleGit(this.storePath);
      await git.init();
      await git.addRemote("origin", remoteUrl);
      await writeFile(join(this.storePath, ".gitkeep"), "");
      await git.add(".").commit("initial claudefy store");
      await git.push(["-u", "origin", "main"]);
    }

    this.git = simpleGit(this.storePath);
  }

  async commitAndPush(message: string): Promise<void> {
    this.ensureInitialized();
    await this.git!.add(".");
    const status = await this.git!.status();
    if (!status.isClean()) {
      await this.git!.commit(message);
      await this.git!.push();
    }
  }

  async pull(): Promise<void> {
    this.ensureInitialized();
    await this.git!.pull();
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
    const { readdirSync } = await import("node:fs");
    const entries = readdirSync(this.storePath);
    for (const entry of entries) {
      if (entry === ".git") continue;
      await rm(join(this.storePath, entry), { recursive: true, force: true });
    }
    await this.writeOverrideMarker(machineId);
    await this.git!.add(".");
    await this.git!.commit(`override: ${machineId} at ${new Date().toISOString()}`);
    await this.git!.push(["--force"]);
  }

  getStorePath(): string {
    return this.storePath;
  }

  private ensureInitialized(): void {
    if (!this.git) {
      throw new Error("GitAdapter not initialized. Call initStore() first.");
    }
  }
}
