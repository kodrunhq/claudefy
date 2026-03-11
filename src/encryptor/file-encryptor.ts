import { aessiv } from "@noble/ciphers/aes.js";
import { deriveFileKey } from "./key-derivation.js";

export class FileEncryptor {
  private key: Uint8Array;

  constructor(passphrase: string) {
    this.key = deriveFileKey(passphrase);
  }

  encrypt(data: Uint8Array, ad: string): string {
    const adBytes = new TextEncoder().encode(ad);
    const cipher = aessiv(this.key, adBytes);
    const encrypted = cipher.encrypt(data);
    return Buffer.from(encrypted).toString("base64");
  }

  decrypt(encoded: string, ad: string): Uint8Array {
    const adBytes = new TextEncoder().encode(ad);
    const cipher = aessiv(this.key, adBytes);
    const encrypted = new Uint8Array(Buffer.from(encoded, "base64"));
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
