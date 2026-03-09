import { Encrypter, Decrypter } from "age-encryption";
import { readFile, writeFile } from "node:fs/promises";

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
}
