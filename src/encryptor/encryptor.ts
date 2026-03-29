import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { LineEncryptor } from "./line-encryptor.js";
import { FileEncryptor } from "./file-encryptor.js";

export class Encryptor {
  private lineEncryptor: LineEncryptor;
  private fileEncryptor: FileEncryptor;

  constructor(passphrase: string, repoSalt: string) {
    this.lineEncryptor = new LineEncryptor(passphrase, repoSalt);
    this.fileEncryptor = new FileEncryptor(passphrase, repoSalt);
  }

  private isJsonlFile(filePath: string): boolean {
    return filePath.endsWith(".jsonl");
  }

  private isOriginallyJsonl(agePath: string): boolean {
    return agePath.endsWith(".jsonl.age");
  }

  async encryptFile(inputPath: string, outputPath: string, ad: string): Promise<void> {
    if (this.isJsonlFile(inputPath)) {
      const content = await readFile(inputPath, "utf-8");
      const encrypted = this.lineEncryptor.encryptFileContent(content, ad);
      await writeFile(outputPath, encrypted);
    } else {
      const data = await readFile(inputPath);
      const encrypted = this.fileEncryptor.encrypt(new Uint8Array(data), ad);
      await writeFile(outputPath, encrypted);
    }
  }

  async decryptFile(inputPath: string, outputPath: string, ad: string): Promise<void> {
    const content = await readFile(inputPath, "utf-8");
    if (content.trim() === "") {
      await writeFile(outputPath, "");
      return;
    }
    if (this.isOriginallyJsonl(inputPath)) {
      const decrypted = this.lineEncryptor.decryptFileContent(content, ad);
      await writeFile(outputPath, decrypted);
    } else {
      const decrypted = this.fileEncryptor.decrypt(content, ad);
      await writeFile(outputPath, decrypted);
    }
  }

  async encryptString(input: string, ad: string): Promise<string> {
    return this.fileEncryptor.encryptString(input, ad);
  }

  async decryptString(encrypted: string, ad: string): Promise<string> {
    return this.fileEncryptor.decryptString(encrypted, ad);
  }

  async encryptDirectory(dirPath: string): Promise<void> {
    await this._encryptDirRecursive(dirPath, dirPath);
  }

  private async _encryptDirRecursive(dirPath: string, rootPath: string): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this._encryptDirRecursive(fullPath, rootPath);
      } else if (!entry.name.endsWith(".age")) {
        const ad = relative(rootPath, fullPath).split(sep).join("/");
        await this.encryptFile(fullPath, fullPath + ".age", ad);
        await rm(fullPath);
      }
    }
  }

  async decryptDirectory(dirPath: string): Promise<void> {
    const { total, failCount } = await this._decryptDirRecursive(dirPath, dirPath);
    if (total > 0 && failCount === total) {
      throw new Error(
        `Passphrase appears incorrect: all ${total} encrypted file(s) failed to decrypt. ` +
          `Check your CLAUDEFY_PASSPHRASE or keychain entry.`,
      );
    }
  }

  private async _decryptDirRecursive(
    dirPath: string,
    rootPath: string,
  ): Promise<{ total: number; failCount: number }> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    let total = 0;
    let failCount = 0;
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const sub = await this._decryptDirRecursive(fullPath, rootPath);
        total += sub.total;
        failCount += sub.failCount;
      } else if (entry.name.endsWith(".age")) {
        total++;
        const outputPath = fullPath.replace(/\.age$/, "");
        const ad = relative(rootPath, outputPath).split(sep).join("/");
        try {
          await this.decryptFile(fullPath, outputPath, ad);
          await rm(fullPath);
        } catch {
          // Preserve the .age file on failure — it may be a pre-existing non-claudefy .age file
          // or the passphrase may be wrong. Do not delete so the user can recover.
          failCount++;
        }
      }
    }
    return { total, failCount };
  }
}
