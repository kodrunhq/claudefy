import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

const LINE_SALT_PREFIX = "claudefy-line-v2:";
const FILE_SALT_PREFIX = "claudefy-file-v2:";
const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH_BYTES = 32;

/**
 * Normalize a git remote URL to a canonical form so that equivalent URLs
 * (SSH vs HTTPS, trailing .git, different casing on host) produce the same salt.
 *
 * Examples:
 *   git@github.com:user/repo.git   -> github.com/user/repo
 *   https://github.com/user/repo   -> github.com/user/repo
 *   ssh://git@github.com/user/repo -> github.com/user/repo
 */
export function normalizeRepoUrl(url: string): string {
  let normalized = url.trim();

  // SSH shorthand: git@host:path -> host/path
  const sshShorthand = /^[\w.-]+@([\w.-]+):(.+)$/;
  const sshMatch = normalized.match(sshShorthand);
  if (sshMatch) {
    normalized = `${sshMatch[1]}/${sshMatch[2]}`;
  } else {
    // Standard URL: strip scheme and userinfo
    normalized = normalized.replace(/^[a-z+]+:\/\//, "");
    normalized = normalized.replace(/^[^@]+@/, "");
  }

  // Strip trailing .git
  normalized = normalized.replace(/\.git$/, "");
  // Strip trailing slashes
  normalized = normalized.replace(/\/+$/, "");
  // Lowercase the host portion (everything before the first /)
  const slashIdx = normalized.indexOf("/");
  if (slashIdx > 0) {
    normalized = normalized.slice(0, slashIdx).toLowerCase() + normalized.slice(slashIdx);
  } else {
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

function deriveKey(passphrase: string, salt: string): Uint8Array {
  const encoder = new TextEncoder();
  return pbkdf2(sha256, encoder.encode(passphrase), encoder.encode(salt), {
    c: PBKDF2_ITERATIONS,
    dkLen: KEY_LENGTH_BYTES,
  });
}

export function deriveLineKey(passphrase: string, repoSalt: string): Uint8Array {
  return deriveKey(passphrase, LINE_SALT_PREFIX + normalizeRepoUrl(repoSalt));
}

export function deriveFileKey(passphrase: string, repoSalt: string): Uint8Array {
  return deriveKey(passphrase, FILE_SALT_PREFIX + normalizeRepoUrl(repoSalt));
}
