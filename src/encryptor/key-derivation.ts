import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

const LINE_SALT_PREFIX = "claudefy-line-v2:";
const FILE_SALT_PREFIX = "claudefy-file-v2:";
const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH_BYTES = 32;

function deriveKey(passphrase: string, salt: string): Uint8Array {
  const encoder = new TextEncoder();
  return pbkdf2(sha256, encoder.encode(passphrase), encoder.encode(salt), {
    c: PBKDF2_ITERATIONS,
    dkLen: KEY_LENGTH_BYTES,
  });
}

export function deriveLineKey(passphrase: string, repoSalt: string): Uint8Array {
  return deriveKey(passphrase, LINE_SALT_PREFIX + repoSalt);
}

export function deriveFileKey(passphrase: string, repoSalt: string): Uint8Array {
  return deriveKey(passphrase, FILE_SALT_PREFIX + repoSalt);
}
