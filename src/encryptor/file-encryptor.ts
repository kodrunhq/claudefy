import { aessiv } from "@noble/ciphers/aes.js";
import { deriveFileKey } from "./key-derivation.js";

export class FileEncryptor {
  private key: Uint8Array;

  constructor(passphrase: string, repoSalt: string) {
    this.key = deriveFileKey(passphrase, repoSalt);
  }

  encrypt(data: Uint8Array, ad: string): string {
    const adBytes = new TextEncoder().encode(ad);
    const cipher = aessiv(this.key, adBytes);
    const encrypted = cipher.encrypt(data);
    return Buffer.from(encrypted).toString("base64");
  }

  decrypt(encoded: string, ad: string): Uint8Array {
    if (encoded.trim() === "") return new Uint8Array(0);
    const adBytes = new TextEncoder().encode(ad);
    const cipher = aessiv(this.key, adBytes);
    const encrypted = new Uint8Array(Buffer.from(encoded, "base64"));
    if (encrypted.length < 16) {
      throw new Error(
        `Invalid ciphertext: expected at least 16 bytes but got ${encrypted.length}. ` +
          `File may not be encrypted or may be corrupted (ad="${ad}")`,
      );
    }
    return cipher.decrypt(encrypted);
  }

  encryptString(text: string, ad: string): string {
    if (text === "") return "";
    return this.encrypt(new TextEncoder().encode(text), ad);
  }

  decryptString(encoded: string, ad: string): string {
    if (encoded === "") return "";
    const decrypted = this.decrypt(encoded, ad);
    return new TextDecoder().decode(decrypted);
  }
}
