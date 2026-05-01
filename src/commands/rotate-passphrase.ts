import { readdir, rename, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { existsSync } from "node:fs";
import { ConfigManager } from "../config/config-manager.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { Encryptor } from "../encryptor/encryptor.js";
import { prompt, storePassphraseInKeychain } from "../encryptor/passphrase.js";
import { output } from "../output.js";
import { withLock } from "../lockfile/lockfile.js";
import { CLAUDEFY_DIR } from "../config/defaults.js";

export interface RotatePassphraseOptions {
  readonly quiet?: boolean;
  readonly oldPassphrase?: string;
  readonly newPassphrase?: string;
}

export class RotatePassphraseCommand {
  private readonly homeDir: string;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
  }

  async execute(options: RotatePassphraseOptions): Promise<void> {
    const claudefyDir = join(this.homeDir, CLAUDEFY_DIR);
    await withLock("rotate-passphrase", !!options.quiet, claudefyDir, async () => {
      const configManager = new ConfigManager(this.homeDir);
      const config = await configManager.load();

      if (!config.encryption.enabled) {
        throw new Error("Encryption is not enabled. Nothing to rotate.");
      }

      const oldPass = options.oldPassphrase ?? (await prompt("Enter current passphrase: ", true));
      if (!oldPass) {
        throw new Error("Old passphrase is required.");
      }

      const newPass = options.newPassphrase ?? (await prompt("Enter new passphrase: ", true));
      if (!newPass) {
        throw new Error("New passphrase is required.");
      }

      if (!options.newPassphrase) {
        const confirm = await prompt("Confirm new passphrase: ", true);
        if (newPass !== confirm) {
          throw new Error("Passphrases do not match.");
        }
      }

      const gitAdapter = new GitAdapter(claudefyDir);
      await gitAdapter.initStore(config.backend.url);
      await gitAdapter.ensureMachineBranch(config.machineId);
      const storePath = gitAdapter.getStorePath();

      const ageFiles = await this.collectAgeFiles(storePath);
      if (ageFiles.length === 0) {
        output.info("No encrypted files found in store.");
        return;
      }

      const oldEncryptor = new Encryptor(oldPass, config.backend.url);
      const newEncryptor = new Encryptor(newPass, config.backend.url);

      // Phase 1: Decrypt all files to plaintext and re-encrypt to .new files.
      // If any file fails here, NO renames happen — originals are preserved.
      const plainFiles: string[] = [];
      const newAgeFiles: string[] = [];
      let phase1Succeeded = 0;

      try {
        for (const ageFile of ageFiles) {
          const plainFile = ageFile.replace(/\.age$/, "");
          const tmpNewAge = `${ageFile}.new`;
          const ad = relative(storePath, plainFile).split(sep).join("/");
          try {
            await oldEncryptor.decryptFile(ageFile, plainFile, ad);
            plainFiles.push(plainFile);
            await newEncryptor.encryptFile(plainFile, tmpNewAge, ad);
            newAgeFiles.push(tmpNewAge);
            phase1Succeeded++;
          } catch (err) {
            throw new Error(
              `Rotation aborted after ${phase1Succeeded} of ${ageFiles.length} files before failure: ${(err as Error).message}`,
              { cause: err },
            );
          }
        }
      } finally {
        // Cleanup: always remove plaintext files and any .new artifacts from failed Phase 1
        for (const p of plainFiles) {
          if (existsSync(p)) await rm(p).catch(() => {}); // Best-effort cleanup — file may already be gone
        }
        if (phase1Succeeded < ageFiles.length) {
          for (const tmpNew of newAgeFiles) {
            if (existsSync(tmpNew)) await rm(tmpNew).catch(() => {}); // Best-effort cleanup — file may already be gone
          }
        }
      }

      // Phase 2: Replace each original with the .new file.
      // On POSIX rename() is atomic. On Windows rename() fails if dest exists,
      // so we remove the destination first.
      for (let i = 0; i < ageFiles.length; i++) {
        if (existsSync(ageFiles[i])) await rm(ageFiles[i], { force: true });
        await rename(newAgeFiles[i], ageFiles[i]);
      }
      const rotated = ageFiles.length;

      // Update keychain if enabled
      if (config.encryption.useKeychain) {
        const stored = await storePassphraseInKeychain(newPass);
        if (stored) {
          if (!options.quiet) output.info("Keychain updated.");
        } else {
          output.warn("Failed to update keychain. Update manually.");
        }
      }

      // Commit and push
      await gitAdapter.commitAndPush("rotate: passphrase rotated", config.machineId);

      if (!options.quiet) {
        output.success(`Passphrase rotated. ${rotated} file(s) re-encrypted.`);
        output.warn(
          "Note: Previous versions of encrypted files in git history remain decryptable\n" +
            "with the old passphrase. To fully purge old encrypted data, delete and\n" +
            "recreate the remote repository with 'claudefy override --confirm'.",
        );
      }
    });
  }

  private async collectAgeFiles(dir: string): Promise<readonly string[]> {
    const results: string[] = [];
    if (!existsSync(dir)) return results;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git") continue;
        results.push(...(await this.collectAgeFiles(fullPath)));
      } else if (entry.name.endsWith(".age")) {
        results.push(fullPath);
      }
    }
    return results;
  }
}
