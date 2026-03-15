import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { ConfigManager } from "../config/config-manager.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { PushCommand } from "./push.js";
import { HookManager } from "../hook-manager/hook-manager.js";
import { output } from "../output.js";
import { promptPassphraseSetup } from "../encryptor/passphrase.js";
import { withLock } from "../lockfile/lockfile.js";

const LFS_GITATTRIBUTES = [
  "projects/**/*.jsonl filter=lfs diff=lfs merge=lfs -text",
  "projects/**/*.jsonl.age filter=lfs diff=lfs merge=lfs -text",
  "",
].join("\n");

export interface InitOptions {
  backend?: string;
  quiet: boolean;
  skipEncryption?: boolean;
  skipSecretScan?: boolean;
  passphrase?: string;
  installHooks?: boolean;
  createRepo?: boolean;
}

export class InitCommand {
  private homeDir: string;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
  }

  async execute(options: InitOptions): Promise<void> {
    const claudefyDir = join(this.homeDir, ".claudefy");
    await withLock("init", !!options.quiet, claudefyDir, async () => {
      let backend = options.backend;

      if (!backend && options.createRepo) {
        const { RepoCreator } = await import("../repo-creator/repo-creator.js");
        const creator = new RepoCreator();
        const repoName = "claude-sync";
        backend = await creator.create(repoName);
        if (!options.quiet) {
          output.info(`Created remote repository: ${backend}`);
        }
      }

      if (!backend) {
        throw new Error("Either --backend <url> or --create-repo is required.");
      }

      const configManager = new ConfigManager(this.homeDir);

      if (configManager.isInitialized()) {
        throw new Error("claudefy is already initialized. Use 'claudefy push' to sync.");
      }

      // Prompt for passphrase if not provided and not skipping encryption
      let passphrase = options.passphrase;
      let useKeychain = false;
      let skipEncryption = options.skipEncryption ?? false;

      if (!passphrase && !skipEncryption && process.stdin.isTTY) {
        const setup = await promptPassphraseSetup();
        if (setup) {
          passphrase = setup.passphrase;
          useKeychain = setup.storedInKeychain;
        } else {
          skipEncryption = true;
        }
      }

      // 1. Initialize config
      const config = await configManager.initialize(backend, { useKeychain });

      if (skipEncryption) {
        config.encryption.enabled = false;
        await configManager.set("encryption.enabled", false);
      }

      if (!options.quiet) {
        output.info(`Initialized claudefy with machine ID: ${config.machineId}`);
      }

      // 2. Initialize git store
      const gitAdapter = new GitAdapter(join(this.homeDir, ".claudefy"));
      await gitAdapter.initStore(backend);
      await gitAdapter.ensureMachineBranch(config.machineId);

      // 3. Write .gitattributes for LFS tracking of large session files
      await writeFile(join(gitAdapter.getStorePath(), ".gitattributes"), LFS_GITATTRIBUTES);

      // 4. Run initial push
      const pushCommand = new PushCommand(this.homeDir);
      await pushCommand.execute({
        quiet: options.quiet,
        skipEncryption,
        skipSecretScan: options.skipSecretScan,
        passphrase,
      });

      // 5. Install hooks if requested
      if (options.installHooks) {
        const hookManager = new HookManager(join(this.homeDir, ".claude", "settings.json"));
        await hookManager.install();
        if (!options.quiet) {
          output.info("Auto-sync hooks installed.");
        }
      }

      if (!options.quiet) {
        output.success("Setup complete. Your Claude config is now synced.");
      }
    });
  }
}
