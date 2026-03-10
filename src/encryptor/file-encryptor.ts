import { aessiv } from "@noble/ciphers/aes.js";
import { deriveFileKey } from "./key-derivation.js";

export class FileEncryptor {
  private key: Uint8Array;

  constructor(passphrase: string) {
    this.key = deriveFileKey(passphrase);
  }

  encrypt(data: Uint8Array): string {
    const cipher = aessiv(this.key, new Uint8Array(0));
    const encrypted = cipher.encrypt(data);
    return Buffer.from(encrypted).toString("base64");
  }

  decrypt(encoded: string): Uint8Array {
    const cipher = aessiv(this.key, new Uint8Array(0));
    const encrypted = new Uint8Array(Buffer.from(encoded, "base64"));
    return cipher.decrypt(encrypted);
  }

  encryptString(text: string): string {
    if (text === "") return "";
    return this.encrypt(new TextEncoder().encode(text));
  }

  decryptString(encoded: string): string {
    if (encoded === "") return "";
    const decrypted = this.decrypt(encoded);
    return new TextDecoder().decode(decrypted);
  }
}
