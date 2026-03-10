import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LineEncryptor } from "./line-encryptor.js";
import { FileEncryptor } from "./file-encryptor.js";

export class Encryptor {
  private lineEncryptor: LineEncryptor;
  private fileEncryptor: FileEncryptor;

  constructor(passphrase: string) {
    this.lineEncryptor = new LineEncryptor(passphrase);
    this.fileEncryptor = new FileEncryptor(passphrase);
  }

  private isJsonlFile(filePath: string): boolean {
    return filePath.endsWith(".jsonl");
  }

  private isOriginallyJsonl(agePath: string): boolean {
    return agePath.endsWith(".jsonl.age");
  }

  async encryptFile(inputPath: string, outputPath: string): Promise<void> {
    if (this.isJsonlFile(inputPath)) {
      const content = await readFile(inputPath, "utf-8");
      const encrypted = this.lineEncryptor.encryptFileContent(content);
      await writeFile(outputPath, encrypted);
    } else {
      const data = await readFile(inputPath);
      const encrypted = this.fileEncryptor.encrypt(new Uint8Array(data));
      await writeFile(outputPath, encrypted);
    }
  }

  async decryptFile(inputPath: string, outputPath: string): Promise<void> {
    const content = await readFile(inputPath, "utf-8");
    if (this.isOriginallyJsonl(inputPath)) {
      const decrypted = this.lineEncryptor.decryptFileContent(content);
      await writeFile(outputPath, decrypted);
    } else {
      const decrypted = this.fileEncryptor.decrypt(content);
      await writeFile(outputPath, decrypted);
    }
  }

  async encryptString(input: string): Promise<string> {
    return this.fileEncryptor.encryptString(input);
  }

  async decryptString(encrypted: string): Promise<string> {
    return this.fileEncryptor.decryptString(encrypted);
  }

  async encryptDirectory(dirPath: string): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.encryptDirectory(fullPath);
      } else if (!entry.name.endsWith(".age")) {
        await this.encryptFile(fullPath, fullPath + ".age");
        await rm(fullPath);
      }
    }
  }

  async decryptDirectory(dirPath: string): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.decryptDirectory(fullPath);
      } else if (entry.name.endsWith(".age")) {
        const outputPath = fullPath.replace(/\.age$/, "");
        await this.decryptFile(fullPath, outputPath);
        await rm(fullPath);
      }
    }
  }
}
