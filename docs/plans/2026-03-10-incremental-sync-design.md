# Incremental Sync with Per-Machine Branches

**Date**: 2026-03-10
**Status**: Approved
**Scope**: Replace nuke-and-rebuild sync with incremental, deterministic, branch-per-machine architecture

## Problem Statement

The current push pipeline deletes and re-copies all files every sync, producing large commits even when nothing changed. Age encryption is non-deterministic (same plaintext produces different ciphertext), so every encrypted file appears "modified" in git. The manifest timestamp updates on every push, guaranteeing a commit. Combined, a no-op session exit produced 136 files changed with 13,655 lines added.

Additionally, there is no concurrency model — two machines pushing simultaneously can lose data, and encrypted files cannot be diffed or merged.

## Design

### 1. Branch Strategy

Each machine gets its own branch (`machines/<machineId>`), with `main` as the merged state.

**Push (SessionEnd)**:
1. Commit changes to `machines/<machineId>`
2. Push machine branch to remote
3. Attempt to merge machine branch into `main` and push
4. If main merge fails (stale), push machine branch anyway — main resolved on next pull

**Pull (SessionStart)**:
1. Fetch all remote branches
2. Pull latest `main`
3. Merge `main` into machine branch (fast-forward in most cases)
4. Apply to `~/.claude`

**Override**:
1. Force-update `main` to match machine branch
2. Push `main` with `--force`
3. Other machines get override on next pull (existing marker system stays)

### 2. Incremental Push

Replace the nuke-and-rebuild with incremental copy.

**Pipeline**:
1. Classify `~/.claude` contents (allowlist/denylist/unknown)
2. Copy allowlisted items to `config/` with `cp --force` (overwrite changed, add new)
3. Copy unknown items to `unknown/` with `cp --force`
4. Detect deleted files — walk store directories, remove files no longer in `~/.claude`
5. Normalize paths (deterministic output, unchanged files stay unchanged)
6. Scan for secrets + encrypt only files with detected secrets
7. Update manifest only if there are actual changes staged
8. Commit and push

### 3. Deterministic Encryption (AES-256-SIV)

Replace age encryption entirely with AES-256-SIV from `@noble/ciphers`.

**For `.jsonl` files** (session transcripts, history):
- Per-line encryption: each line encrypted independently
- Output: base64-encoded text, one line per encrypted line
- Deterministic: same line + same key = same ciphertext
- Git can diff and merge naturally (only changed/added lines show in diffs)

**For all other files with secrets** (JSON configs, unknown files):
- File-level deterministic encryption
- Entire content encrypted as one block, stored as base64 with `.age` extension
- No merge support (LWW via git), but no spurious diffs

**Key derivation**:
- HMAC-SHA256(passphrase, salt) where salt is `claudefy-line-v1` or `claudefy-file-v1`
- Produces 32-byte key for AES-256-SIV

**Tradeoff**: ~38% size increase from base64 encoding. Acceptable given determinism, mergeability, and 12-100x faster encryption (benchmarked in `benchmarks/per-line-encryption.ts`).

**No migration needed** — clean break, users delete remote and re-push.

### 4. Manifest and Registry

Only update `lastSync` when there are actual config changes to commit.

1. Copy files, normalize, encrypt
2. `git add .` and check `git status`
3. If clean: skip manifest update, skip commit, log "Nothing changed"
4. If dirty: update `lastSync`, commit, push

### 5. Push Atomicity

Use staging directory to prevent corruption on failure.

1. Process all files in `<storePath>/.staging/`
2. Classify, copy, normalize, scan, encrypt — all in staging
3. Only if everything succeeds: swap staging into real `config/` and `unknown/`
4. Delete staging dir
5. `git add .`, check status, commit if dirty, push

If any step fails, staging is discarded — store retains previous valid state.

### 6. Pull Improvements

Store is never modified during pull.

1. Fetch + pull latest `main`
2. Merge `main` into machine branch
3. Decrypt encrypted files into a temporary working directory (not in the store)
4. Remap paths (canonical to local)
5. Merge/copy to `~/.claude`
6. Discard temporary working directory

No re-encryption after pull. No "sync: pull" commits.

### 7. Bug Fixes

Included as part of this work:

1. **Path traversal in push.ts** — add containment check to directory rename (pull.ts has it, push.ts doesn't)
2. **JoinCommand registers before pull** — move registration after successful pull
3. **Silent push failures** — `commitAndPush` returns success/failure so callers can react
4. **Settings hooks drift** — when stripping hooks from remote on pull, preserve non-claudefy hook entries instead of deleting all hooks

### 8. Documentation Updates

1. **Architecture section** — per-machine branch strategy, push/pull flow, what gets synced
2. **Encryption section** — AES-SIV deterministic encryption, per-line vs file-level, size tradeoff
3. **Multi-machine workflow** — practical guide for switching between machines
4. **Override explained** — when to use, what it does, effect on other machines
5. **Security model** — what's encrypted, what's never synced, scanner limitations
6. **SyncFilter reference** — full allowlist/denylist with descriptions, customization via overrides

## Files Affected

### New files
- `src/encryptor/line-encryptor.ts` — per-line AES-SIV encryption
- `src/encryptor/file-encryptor.ts` — file-level AES-SIV encryption

### Major changes
- `src/commands/push.ts` — incremental copy, staging dir, branch logic, conditional manifest
- `src/commands/pull.ts` — temp working dir for decrypt, no re-encrypt, branch merge
- `src/git-adapter/git-adapter.ts` — per-machine branches, merge to main, return success/failure
- `src/encryptor/encryptor.ts` — replace age with AES-SIV delegation
- `src/commands/override.ts` — force-update main to machine branch
- `src/machine-registry/machine-registry.ts` — conditional lastSync update

### Bug fixes
- `src/commands/push.ts` — path traversal containment check on dir rename
- `src/commands/join.ts` — register after pull
- `src/commands/pull.ts` — preserve non-claudefy hooks

### Documentation
- `README.md` — architecture, encryption, multi-machine workflow, security model, sync filter reference

### Removed dependencies
- `age-encryption` — replaced entirely by `@noble/ciphers` + `@noble/hashes`

## Benchmark Results

From `benchmarks/per-line-encryption.ts`:

| Lines | AES-SIV encrypt | Age encrypt | Speedup |
|-------|----------------|-------------|---------|
| 50    | 8ms            | 804ms       | 100x    |
| 200   | 8ms            | 757ms       | 95x     |
| 500   | 13ms           | 757ms       | 58x     |
| 1000  | 22ms           | 783ms       | 35x     |
| 3000  | 61ms           | 759ms       | 12x     |

Determinism verified: same content encrypted twice produces identical output.
