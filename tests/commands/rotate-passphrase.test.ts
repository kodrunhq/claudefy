import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RotatePassphraseCommand } from "../../src/commands/rotate-passphrase.js";
import { PushCommand } from "../../src/commands/push.js";
import { Encryptor } from "../../src/encryptor/encryptor.js";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";
import { existsSync } from "node:fs";

describe("RotatePassphraseCommand", () => {
  let homeDir: string;
  let claudeDir: string;
  let remoteDir: string;
  const oldPass = "old-passphrase-123";
  const newPass = "new-passphrase-456";
  const backendUrl = "";

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-rotate-test-"));
    claudeDir = join(homeDir, ".claude");
    await mkdir(claudeDir, { recursive: true });

    // Set up bare remote
    remoteDir = await mkdtemp(join(tmpdir(), "claudefy-remote-rotate-"));
    await simpleGit(remoteDir).init(true, ["-b", "main"]);

    // Create test content
    await writeFile(join(claudeDir, "settings.json"), JSON.stringify({ theme: "dark" }));
    await mkdir(join(claudeDir, "commands"), { recursive: true });
    await writeFile(join(claudeDir, "commands", "test.md"), "# test");

    // Set up claudefy config with encryption enabled
    const claudefyDir = join(homeDir, ".claudefy");
    await mkdir(join(claudefyDir, "backups"), { recursive: true });
    await writeFile(
      join(claudefyDir, "config.json"),
      JSON.stringify({
        version: 1,
        backend: { type: "git", url: remoteDir },
        encryption: { enabled: true, useKeychain: false, cacheDuration: "0", mode: "reactive" },
        machineId: "test-machine",
      }),
    );
    await writeFile(join(claudefyDir, "links.json"), "{}");
    await writeFile(
      join(claudefyDir, "sync-filter.json"),
      JSON.stringify({
        allowlist: ["settings.json", "commands"],
        denylist: ["cache"],
      }),
    );

    // Initial push with old passphrase (with secret scan to trigger encryption)
    const push = new PushCommand(homeDir);
    // Push without encryption first to get store set up, then we'll add encrypted files directly
    await push.execute({ quiet: true, skipEncryption: false, passphrase: oldPass });
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  it("re-encrypts files successfully on rotation", async () => {
    const storePath = join(homeDir, ".claudefy", "store");

    // Check if any .age files exist in store (depends on secret scanner)
    const ageFiles = await findAgeFiles(storePath);
    if (ageFiles.length === 0) {
      // No encrypted files — inject one directly
      const encryptor = new Encryptor(oldPass, remoteDir);
      const configDir = join(storePath, "config");
      await encryptor.encryptFile(
        join(configDir, "settings.json"),
        join(configDir, "settings.json.age"),
        "config/settings.json",
      );
      await rm(join(configDir, "settings.json"));

      // Commit the encrypted file
      const git = simpleGit(storePath);
      await git.add(".");
      await git.commit("add encrypted file for rotation test");
    }

    const rotate = new RotatePassphraseCommand(homeDir);
    await rotate.execute({ quiet: true, oldPassphrase: oldPass, newPassphrase: newPass });

    // Verify re-encryption: .age files should now be decryptable with new passphrase
    const newEncryptor = new Encryptor(newPass, remoteDir);
    const ageFilesAfter = await findAgeFiles(join(homeDir, ".claudefy", "store"));
    expect(ageFilesAfter.length).toBeGreaterThan(0);

    for (const ageFile of ageFilesAfter) {
      const outPath = ageFile.replace(/\.age$/, ".decrypted");
      const ad = ageFile
        .replace(join(homeDir, ".claudefy", "store") + "/", "")
        .replace(/\.age$/, "");
      await expect(newEncryptor.decryptFile(ageFile, outPath, ad)).resolves.not.toThrow();
      await rm(outPath, { force: true });
    }
  });

  it("throws when wrong old passphrase is provided", async () => {
    const storePath = join(homeDir, ".claudefy", "store");

    // Inject an encrypted file so rotation has something to work with
    const encryptor = new Encryptor(oldPass, remoteDir);
    const configDir = join(storePath, "config");
    await encryptor.encryptFile(
      join(configDir, "settings.json"),
      join(configDir, "settings.json.age"),
      "config/settings.json",
    );
    await rm(join(configDir, "settings.json"));
    const git = simpleGit(storePath);
    await git.add(".");
    await git.commit("add encrypted file");

    const rotate = new RotatePassphraseCommand(homeDir);
    await expect(
      rotate.execute({ quiet: true, oldPassphrase: "wrong-passphrase", newPassphrase: newPass }),
    ).rejects.toThrow(/incorrect|wrong.*pass|aborted|failed/i);
  });

  it("leaves no plaintext files after rotation", async () => {
    const storePath = join(homeDir, ".claudefy", "store");

    // Inject an encrypted file
    const encryptor = new Encryptor(oldPass, remoteDir);
    const configDir = join(storePath, "config");
    await encryptor.encryptFile(
      join(configDir, "settings.json"),
      join(configDir, "settings.json.age"),
      "config/settings.json",
    );
    await rm(join(configDir, "settings.json"));
    const git = simpleGit(storePath);
    await git.add(".");
    await git.commit("add encrypted file");

    const rotate = new RotatePassphraseCommand(homeDir);
    await rotate.execute({ quiet: true, oldPassphrase: oldPass, newPassphrase: newPass });

    // No plaintext files should remain in the config directory
    const configEntries = await readdir(configDir);
    for (const entry of configEntries) {
      if (!entry.endsWith(".age") && entry !== ".gitkeep") {
        // Plain settings.json should not exist alongside .age
        expect(existsSync(join(configDir, "settings.json"))).toBe(false);
      }
    }
    // .age file must still exist
    expect(existsSync(join(configDir, "settings.json.age"))).toBe(true);
  });
});

async function findAgeFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== ".git") {
      results.push(...(await findAgeFiles(fullPath)));
    } else if (entry.name.endsWith(".age")) {
      results.push(fullPath);
    }
  }
  return results;
}
