import { Encrypter, Decrypter } from "age-encryption";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class Encryptor {
  private passphrase: string;

  constructor(passphrase: string) {
    this.passphrase = passphrase;
  }

  async encryptFile(inputPath: string, outputPath: string): Promise<void> {
    const data = await readFile(inputPath);
    const e = new Encrypter();
    e.setPassphrase(this.passphrase);
    const encrypted = await e.encrypt(data);
    await writeFile(outputPath, encrypted);
  }

  async decryptFile(inputPath: string, outputPath: string): Promise<void> {
    const data = await readFile(inputPath);
    const d = new Decrypter();
    d.addPassphrase(this.passphrase);
    const decrypted = await d.decrypt(data, "uint8array");
    await writeFile(outputPath, decrypted);
  }

  async encryptString(input: string): Promise<string> {
    const e = new Encrypter();
    e.setPassphrase(this.passphrase);
    const encrypted = await e.encrypt(new TextEncoder().encode(input));
    return Buffer.from(encrypted).toString("base64");
  }

  async decryptString(base64Input: string): Promise<string> {
    const data = new Uint8Array(Buffer.from(base64Input, "base64"));
    const d = new Decrypter();
    d.addPassphrase(this.passphrase);
    const decrypted = await d.decrypt(data, "uint8array");
    return new TextDecoder().decode(decrypted);
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
