# Claudefy Hardening v1.1

**Date**: 2026-03-11
**Status**: Approved
**Scope**: 10 improvements addressing code review feedback — encryption, incremental sync, security, cleanup, and new commands

## Overview

Single branch with atomic commits per item. No migration needed — remote store can be destroyed and re-pushed. Commit order chosen so dependencies land before dependents.

## 1. AD Binding for AES-SIV

**Problem**: `FileEncryptor` and `LineEncryptor` pass empty associated data (`new Uint8Array(0)`) to `aessiv()`. An attacker could swap encrypted blobs between files undetected.

**Change**: Pass the store-relative file path (e.g., `config/settings.json`) as associated data. This binds ciphertext to its location — decryption fails if the blob is moved.

**Files**: `file-encryptor.ts`, `line-encryptor.ts`, `encryptor.ts`, push/pull call sites.

**API changes**:
- `FileEncryptor`: `encrypt(data, ad)` and `decrypt(encoded, ad)` gain a required `ad: string` parameter.
- `LineEncryptor`: `encryptLine(line, ad)`, `decryptLine(encoded, ad)`, and batch methods gain `ad: string`.
- `Encryptor` facade: `encryptFile(inputPath, outputPath, ad)` and `decryptFile(inputPath, outputPath, ad)` gain `ad: string`. The **caller** (push/pull commands) computes the store-relative path and passes it in. `encryptDirectory`/`decryptDirectory` compute relative paths internally from their `dirPath` root.
- `encryptString`/`decryptString`: gain `ad: string` parameter. Callers provide context-appropriate AD.

**User-facing renames in `~/.claude`**: No breakage. Push re-encrypts from source under the new store path. Pull decrypts using the path the file is stored under.

## 2. Delete Dead `lastWriteWins`

**Problem**: `Merger.lastWriteWins()` exists but is never called. Pull uses `cp --force` (remote always wins).

**Change**: Delete the method and its tests.

## 3. Incremental Staging

**Problem**: Push does `rm -rf staging → copy everything → normalize → encrypt → swap` every time. A no-op push still touches every file.

**Change**: Hash-based diff replaces nuke-and-rebuild.

**Pipeline**:
1. Classify `~/.claude` contents
2. Hash existing store files (SHA-256 of content)
3. For each classified file: read source, normalize if applicable, hash
4. Compare hash to store hash — skip unchanged files
5. Write changed/new files to store directly
6. Detect deletions (store files not in classification) and remove
7. Secret scan changed files only
8. Encrypt changed files with detected secrets
9. Conditional manifest update
10. `git add`, commit if dirty, push

**Atomicity**: The staging dir as a complete swap goes away. Git provides the safety — nothing is committed until the full pipeline succeeds. If push fails mid-write, dirty working tree state is overwritten on next push.

**Hashing**: SHA-256 via `crypto.createHash('sha256')`. For path-normalized files (settings.json, plugins, history.jsonl), hash after normalization so comparison is apples-to-apples.

**Encrypted files**: Store files with secrets are `.age`-encrypted, so raw content hashes won't match plaintext source hashes. Solution: after normalizing and hashing the source file, also encrypt it (deterministic AES-SIV produces identical ciphertext for identical plaintext+key+AD), then hash the encrypted output. Compare that hash against the store's `.age` file hash. Since encryption is deterministic, unchanged files produce identical encrypted output and matching hashes. This avoids decrypting store files.

**Partial write safety**: A crash mid-step-5 could leave the store in an inconsistent state. This is acceptable because: (a) no `git add`/commit happens until step 10, so the inconsistent state is never committed, and (b) the next push overwrites all changed files anyway. If the user runs `git checkout -- .` in the store, they recover the previous committed state.

## 4. Smart Array Merge

**Problem**: `arrayMerge: (_target, source) => source` silently drops local array entries when remote has a different set.

**Change**: Union-by-key for arrays of objects, remote-wins fallback for primitives.

**Logic**:
- Inspect array items for a common unique key (`name`, `id`, or `key` field)
- If found: start with remote items (remote wins on same-key conflicts), append local items whose key is not in remote
- If no key found (primitives, mixed types): fall back to remote-wins (replace entire array)

**Files**: `merger.ts`.

## 5. Expanded Secret Scanner Patterns

**Problem**: Missing Google Cloud, Slack, Azure, Stripe, Twilio, and Datadog patterns.

**New patterns**:

| Pattern | Prefix | Regex suffix |
|---------|--------|-------------|
| Google API Key | `AIza` | `[0-9A-Za-z\-_]{35}` |
| Slack Bot Token | `xo` + `xb-` | `[0-9A-Za-z\-]{50,}` |
| Slack User Token | `xo` + `xp-` | `[0-9A-Za-z\-]{50,}` |
| Stripe Live Key | `s` + `k_live_` | `[0-9a-zA-Z]{24,}` |
| Stripe Test Key | `s` + `k_test_` | `[0-9a-zA-Z]{24,}` |
| Azure Connection String | `AccountKey=` | `[A-Za-z0-9+/=]{44,}` |
| Twilio API Key | `S` + `K` | `[0-9a-fA-F]{32}` |
| Datadog API Key | `dd` | `[a-z]{0,2}_[0-9a-zA-Z]{32,}` |

**Not adding**: High-entropy string detection. False positive rate on config files (base64 blobs, hashes, UUIDs) too high without tuned threshold. Generic JSON pattern covers most real-world leaks.

**Files**: `scanner.ts`, `scanner.test.ts`.

## 6. Recursive JSON Walk for Path Replacement

**Problem**: `replaceInSerialized()` does `JSON.stringify → replaceAll → JSON.parse`. Could mangle non-path string values or break JSON structure.

**Change**: Recursive tree walker that visits only string values:

```typescript
private replaceInValues<T>(value: T, search: string, replacement: string): T {
  if (typeof value === 'string') return value.replaceAll(search, replacement) as T;
  if (Array.isArray(value)) return value.map(item => this.replaceInValues(item, search, replacement)) as T;
  if (value !== null && typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = this.replaceInValues(v, search, replacement);
    }
    return result as T;
  }
  return value;
}
```

Object keys are never modified. Public API unchanged.

**Files**: `path-mapper.ts`.

## 7. Pull Cleanup Safety

**Problem**: If process is killed mid-pull, decrypted plaintext lingers in `.pull-tmp/`.

**Change**:
1. **Startup cleanup**: At beginning of `PullCommand.execute()`, wipe any stale `.pull-tmp/` from a previous crash
2. **Signal handlers**: Register SIGINT/SIGTERM handlers that `rmSync` the tmp dir. Handler removal goes in the `finally` block (not just the success path) to avoid leaking handlers on exceptions.

SIGKILL can't be caught — startup cleanup covers that case on next run.

**Files**: `pull.ts`.

## 8. Static Import Cleanup

**Problem**: `pull.ts` has 3 dynamic `await import("simple-git")` calls even though `simple-git` is already available via `GitAdapter`.

**Change**: Add `import { simpleGit } from "simple-git"` at the top. Replace all dynamic imports with direct calls.

**Files**: `pull.ts`.

## 9. Restore Command

**Problem**: `BackupManager` creates backups but users have no way to restore them except manual `cp -r`.

**New command**: `claudefy restore`

**Behavior**:
1. Lists available backups with numbered index, timestamp, and label
2. User picks a number (interactive `readline` prompt)
3. Confirmation: "This will replace ~/.claude with backup <name>. Continue? (y/N)"
4. Creates safety backup of current `~/.claude` (label: `pre-restore`) before overwriting
5. Copies selected backup to `~/.claude`
6. If no backups exist, prints message and exits

**Flags**: `--quiet` / `-q`

**Files**: new `src/commands/restore.ts`, `backup-manager.ts` (add `getBackupPath`), `cli.ts`.

## 10. Lightweight Update Check

**Problem**: `update-notifier` pulls in `configstore`, `got`, and HTTP deps. ~200ms cold start overhead.

**Change**: Replace with minimal hand-rolled check:
1. Fetch `https://registry.npmjs.org/@kodrunhq/claudefy/latest` using Node built-in `fetch`
2. Cache result in `~/.claudefy/update-check.json` (last check timestamp + latest version)
3. Only fetch if >24 hours since last check
4. If newer version exists, print one-liner to stderr
5. Non-blocking fire-and-forget, silent on failure

**Files**: new `src/update-check.ts`, `index.ts`, remove `update-notifier` from dependencies, delete `src/update-notifier.d.ts`.

## Commit Order

1. `#8` — Static import cleanup (trivial, unblocks #7)
2. `#2` — Delete dead `lastWriteWins`
3. `#1` — AD binding for AES-SIV
4. `#6` — Recursive JSON walk
5. `#5` — Expanded secret scanner patterns
6. `#4` — Smart array merge
7. `#7` — Pull cleanup safety
8. `#3` — Incremental staging (biggest change, dependencies in place)
9. `#9` — Restore command
10. `#10` — Lightweight update check

## Testing Strategy

Each commit includes updated/new tests. Existing 88 tests updated where interfaces change (encryption AD parameter). New tests for: scanner patterns, array merge strategies, recursive walk edge cases, restore command, update check caching.
