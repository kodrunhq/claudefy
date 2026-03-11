# Encryption

## Overview

claudefy encrypts files using **AES-256-SIV** deterministic authenticated encryption from `@noble/ciphers`. Allowlisted files are encrypted reactively (only when the secret scanner detects a match), while unknown-tier files are always encrypted when encryption is enabled.

## Why Deterministic Encryption?

Standard encryption produces different ciphertext every time, even for the same plaintext. This is problematic for git:

- Every push would show every encrypted file as "changed" even if the content didn't change.
- Git's merge machinery can't work with randomized encrypted content.

AES-SIV solves this: **same plaintext + same key + same associated data = same ciphertext**. This means:

- Unchanged files produce zero git diff.
- Git can detect which JSONL lines actually changed.
- Incremental sync works correctly.

## Key Derivation

```
passphrase + salt → PBKDF2-SHA256 → 32-byte AES key
                    (600,000 iterations)
```

### Salt Construction

The salt is derived from the backend URL, ensuring that the same passphrase produces different keys for different repositories:

```
JSONL (line encryption):  "claudefy-line-v2:{normalizedUrl}"
Other (file encryption):  "claudefy-file-v2:{normalizedUrl}"
```

### URL Normalization

SSH, HTTPS, and other URL formats for the same repo all produce the same normalized URL:

| Input | Normalized |
|-------|-----------|
| `git@github.com:user/repo.git` | `github.com/user/repo` |
| `https://github.com/user/repo` | `github.com/user/repo` |
| `ssh://git@github.com/user/repo.git` | `github.com/user/repo` |

This means you can use SSH on one machine and HTTPS on another with the same passphrase, and decryption works correctly.

## Encryption Strategies

### Line-Level Encryption (JSONL files)

JSONL files like `history.jsonl` are encrypted **line by line**:

```
Original:
  {"ts": 1234, "project": "/home/user/app", "message": "fix bug"}
  {"ts": 1235, "project": "/home/user/app", "message": "add tests"}

Encrypted:
  aGVsbG8gd29ybGQ=...   (base64 of AES-SIV ciphertext for line 1)
  dGhpcyBpcyBhIHRlc3Q=... (base64 of AES-SIV ciphertext for line 2)
```

**Benefits:**
- Git can diff individual lines (shows which lines were added/changed).
- Git's merge can handle line-level conflicts.
- Appending new lines doesn't invalidate existing ones.

**Associated data:** The file's relative path in the store (e.g., `config/history.jsonl`), which binds each ciphertext to its file location.

### File-Level Encryption (everything else)

Non-JSONL files are encrypted as a whole:

```
Original:    settings.json (JSON content)
Encrypted:   settings.json.age (base64 ciphertext)
```

**Associated data:** Same — the file's relative path in the store.

## Output Format

Encrypted files use the `.age` extension appended to the original filename:

- `settings.json` → `settings.json.age`
- `history.jsonl` → `history.jsonl.age`
- `plugins/my-plugin.json` → `plugins/my-plugin.json.age`

The original plaintext file is deleted from the store after encryption.

## Size Overhead

Approximately **38%** from base64 encoding of the ciphertext.

## Passphrase Resolution

For `push` and `pull`, claudefy resolves the passphrase in this order (first match wins):

1. **`CLAUDEFY_PASSPHRASE` environment variable** — recommended for CI, scripted use, and auto-sync hooks.
2. **OS keychain** — if `encryption.useKeychain` is `true` in config. Uses `@napi-rs/keyring`.

If neither source provides a passphrase, the command fails with an error.

Interactive prompts for the passphrase only occur during `claudefy init` and `claudefy join`, when you first set or confirm the passphrase and choose whether to store it in the OS keychain.

## What Gets Encrypted

| Scenario | Encrypted? |
|----------|-----------|
| File with detected secrets (API keys, tokens, etc.) | Yes |
| File in the "unknown" tier (encryption enabled) | Always encrypted |
| File in the "allow" tier, no secrets detected | No (plaintext) |
| File in the "deny" tier | Not synced at all |
| Push with secrets detected and encryption disabled | **Push is blocked** (error) |

## Decryption (Pull)

During pull, the Encryptor walks the temp directory looking for `.age` files:

1. Identify strategy: `.jsonl.age` → LineEncryptor, otherwise → FileEncryptor.
2. Decrypt in place, removing the `.age` extension.
3. Continue with path remapping and merging on the decrypted content.
