import { aessiv } from "@noble/ciphers/aes.js";
import { deriveLineKey } from "./key-derivation.js";

export class LineEncryptor {
  private key: Uint8Array;

  constructor(passphrase: string, repoSalt: string) {
    this.key = deriveLineKey(passphrase, repoSalt);
  }

  encryptLine(line: string, ad: string): string {
    const adBytes = new TextEncoder().encode(ad);
    const cipher = aessiv(this.key, adBytes);
    const plaintext = new TextEncoder().encode(line);
    const encrypted = cipher.encrypt(plaintext);
    return Buffer.from(encrypted).toString("base64");
  }

  decryptLine(encoded: string, ad: string): string {
    if (encoded === "") return "";
    const adBytes = new TextEncoder().encode(ad);
    const cipher = aessiv(this.key, adBytes);
    const encrypted = new Uint8Array(Buffer.from(encoded, "base64"));
    if (encrypted.length < 16) {
      throw new Error(
        `Invalid ciphertext on line: expected at least 16 bytes but got ${encrypted.length}. ` +
          `Line may not be encrypted or may be corrupted (ad="${ad}")`,
      );
    }
    const decrypted = cipher.decrypt(encrypted);
    return new TextDecoder().decode(decrypted);
  }

  encryptLines(lines: string[], ad: string): string[] {
    return lines.map((line) => this.encryptLine(line, ad));
  }

  decryptLines(encrypted: string[], ad: string): string[] {
    return encrypted.map((line) => this.decryptLine(line, ad));
  }

  encryptFileContent(content: string, ad: string): string {
    if (content === "") return "";
    const lines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
    const encrypted = this.encryptLines(lines, ad);
    return encrypted.join("\n") + "\n";
  }

  decryptFileContent(content: string, ad: string): string {
    if (content === "" || content.trim() === "") return "";
    const lines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
    const decrypted = this.decryptLines(lines, ad);
    return decrypted.join("\n") + "\n";
  }
}
