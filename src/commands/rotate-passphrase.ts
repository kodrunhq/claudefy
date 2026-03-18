import { readdir, rename, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { existsSync } from "node:fs";
import { ConfigManager } from "../config/config-manager.js";
import { GitAdapter } from "../git-adapter/git-adapter.js";
import { Encryptor } from "../encryptor/encryptor.js";
import { prompt, storePassphraseInKeychain } from "../encryptor/passphrase.js";
import { output } from "../output.js";
import { withLock } from "../lockfile/lockfile.js";

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
    const claudefyDir = join(this.homeDir, ".claudefy");
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
      const storePath = gitAdapter.getStorePath();

      const ageFiles = await this.collectAgeFiles(storePath);
      if (ageFiles.length === 0) {
        output.info("No encrypted files found in store.");
        return;
      }

      // Verify old passphrase by decrypting the first file
      const oldEncryptor = new Encryptor(oldPass, config.backend.url);
      try {
        const testFile = ageFiles[0];
        const plainFile = testFile.replace(/\.age$/, "");
        const ad = relative(storePath, plainFile).split(sep).join("/");
        await oldEncryptor.decryptFile(testFile, plainFile, ad);
        if (existsSync(plainFile)) {
          await rm(plainFile);
        }
      } catch {
        throw new Error("Old passphrase is incorrect. No files were modified.");
      }

      // Re-encrypt all files with the new passphrase
      const newEncryptor = new Encryptor(newPass, config.backend.url);
      let rotated = 0;

      for (const ageFile of ageFiles) {
        const plainFile = ageFile.replace(/\.age$/, "");
        const tmpNewAge = ageFile + ".new";
        const ad = relative(storePath, plainFile).split(sep).join("/");

        try {
          await oldEncryptor.decryptFile(ageFile, plainFile, ad);
          await newEncryptor.encryptFile(plainFile, tmpNewAge, ad);
          await rm(ageFile);
          await rename(tmpNewAge, ageFile);
          await rm(plainFile);
          rotated++;
        } finally {
          // Clean up plaintext and temp files on error
          if (existsSync(plainFile)) await rm(plainFile).catch(() => {});
          if (existsSync(tmpNewAge)) await rm(tmpNewAge).catch(() => {});
        }
      }

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
