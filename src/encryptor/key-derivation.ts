import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

const LINE_SALT = "claudefy-line-v1";
const FILE_SALT = "claudefy-file-v1";
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH_BYTES = 32;

function deriveKey(passphrase: string, salt: string): Uint8Array {
  const encoder = new TextEncoder();
  return pbkdf2(sha256, encoder.encode(passphrase), encoder.encode(salt), {
    c: PBKDF2_ITERATIONS,
    dkLen: KEY_LENGTH_BYTES,
  });
}

export function deriveLineKey(passphrase: string): Uint8Array {
  return deriveKey(passphrase, LINE_SALT);
}

export function deriveFileKey(passphrase: string): Uint8Array {
  return deriveKey(passphrase, FILE_SALT);
}
