import { aessiv } from "@noble/ciphers/aes.js";
import { deriveLineKey } from "./key-derivation.js";

export class LineEncryptor {
  private key: Uint8Array;

  constructor(passphrase: string) {
    this.key = deriveLineKey(passphrase);
  }

  encryptLine(line: string): string {
    const cipher = aessiv(this.key, new Uint8Array(0));
    const plaintext = new TextEncoder().encode(line);
    const encrypted = cipher.encrypt(plaintext);
    return Buffer.from(encrypted).toString("base64");
  }

  decryptLine(encoded: string): string {
    const cipher = aessiv(this.key, new Uint8Array(0));
    const encrypted = new Uint8Array(Buffer.from(encoded, "base64"));
    const decrypted = cipher.decrypt(encrypted);
    return new TextDecoder().decode(decrypted);
  }

  encryptLines(lines: string[]): string[] {
    return lines.map((line) => this.encryptLine(line));
  }

  decryptLines(encrypted: string[]): string[] {
    return encrypted.map((line) => this.decryptLine(line));
  }

  encryptFileContent(content: string): string {
    if (content === "") return "";
    const lines = content.endsWith("\n")
      ? content.slice(0, -1).split("\n")
      : content.split("\n");
    const encrypted = this.encryptLines(lines);
    return encrypted.join("\n") + "\n";
  }

  decryptFileContent(content: string): string {
    if (content === "" || content.trim() === "") return "";
    const lines = content.endsWith("\n")
      ? content.slice(0, -1).split("\n")
      : content.split("\n");
    const decrypted = this.decryptLines(lines);
    return decrypted.join("\n") + "\n";
  }
}
