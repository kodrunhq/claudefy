import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

const LINE_SALT = "claudefy-line-v1";
const FILE_SALT = "claudefy-file-v1";

export function deriveLineKey(passphrase: string): Uint8Array {
  return hmac(sha256, new TextEncoder().encode(passphrase), new TextEncoder().encode(LINE_SALT));
}

export function deriveFileKey(passphrase: string): Uint8Array {
  return hmac(sha256, new TextEncoder().encode(passphrase), new TextEncoder().encode(FILE_SALT));
}
