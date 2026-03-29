# Ace Audit — Fix Plan

**Generated:** 2026-03-29
**Project:** claudefy
**Scope:** Entire codebase (110 files, ~17,225 lines)
**Agents dispatched:** 16/21 (gated: 5 — react-patterns, go-idioms, python-django, rust-safety, state-mgmt)

---

## Executive Summary

**Total findings:** 105 (18 critical, 42 warning, 28 nitpick, 17 suggestions/info)
**Domains with findings:** logic, security, type-soundness, silent-failure, test-coverage, code-quality, wiring, dead-code, spec-compliance, concurrency, contract, product/UX
**Clean agents:** 0/16

---

## Audit Coverage

| Domain | Agent | Findings | Highest Severity |
|--------|-------|----------|-----------------|
| Logic | logic-auditor | 5 | Critical |
| Testing | test-interrogator | 13 | Critical |
| Contracts | contract-verifier | 5 | Warning |
| Wiring | wiring-inspector | 3 | Critical |
| Dead Code | dead-code-scanner | 2 | Critical |
| Spec | spec-checker | 3 | Warning |
| Data Integrity | database-auditor | 5 | Warning |
| Auth/Crypto | auth-flow-verifier | 4 | Warning |
| Types | type-soundness | 13 | Critical |
| Concurrency | concurrency-checker | 4 | Warning |
| Code Quality | code-quality-auditor | 17 | Critical |
| Security | security-auditor | 13 | Critical |
| Scope/Intent | scope-intent-verifier | 3 | Critical |
| Silent Failures | silent-failure-hunter | 14 | Critical |
| Product/UX | product-thinker | 11 | Critical |
| Red Team | red-team | 8 | Critical |

---

## Critical — Must Fix

### Fix 1.1: DANGEROUS_KEYS stripping does not apply to project-level settings.json
- **Agent:** red-team
- **File:** src/commands/pull.ts:381-407
- **Problem:** The DANGEROUS_KEYS filtering (hooks, mcpServers, env, permissions, allowedTools, apiKeyHelper) only applies to the top-level `settings.json`. Project-level settings files inside `projects/<dir>/` are copied verbatim via recursive `cp()`, allowing an attacker with remote write access to inject hooks/mcpServers into per-project settings for arbitrary command execution.
- **Fix:** After copying the `projects/` directory, recursively scan for `settings.json` files within `projects/` subdirectories and strip the same DANGEROUS_KEYS from each one.
- **Dependencies:** None

### Fix 1.2: decryptDirectory with wrong passphrase silently deletes .age files (data loss)
- **Agent:** silent-failure-hunter, test-interrogator, security-auditor, product-thinker
- **File:** src/encryptor/encryptor.ts:91-99
- **Problem:** When decryption fails (wrong passphrase, corrupted file), the catch block deletes the `.age` source file with `await rm(fullPath)`. A pull with the wrong passphrase silently wipes all encrypted config from the staging directory with no error message. User sees "Pull complete" with missing secrets.
- **Fix:** Only delete `fullPath` on successful decryption. On failure, preserve the `.age` file. Count failures; if all decryptions fail, throw a clear "wrong passphrase" error. Log each skipped file.
- **Dependencies:** None

### Fix 1.3: rotate-passphrase commits on wrong branch (missing ensureMachineBranch)
- **Agent:** wiring-inspector, red-team, contract-verifier, security-auditor
- **File:** src/commands/rotate-passphrase.ts:51-53
- **Problem:** `rotate-passphrase` calls `initStore()` but never `ensureMachineBranch()`. The commit lands on whatever branch `initStore` leaves (could be `main`), breaking per-machine branch isolation and potentially corrupting shared state.
- **Fix:** Add `await gitAdapter.ensureMachineBranch(config.machineId);` after `initStore()`, consistent with push/pull.
- **Dependencies:** None

### Fix 1.4: rotate-passphrase partial failure leaves mixed-passphrase state
- **Agent:** logic-auditor, product-thinker, red-team, silent-failure-hunter
- **File:** src/commands/rotate-passphrase.ts:79-95
- **Problem:** The loop has no `catch` block. If file N fails, the exception propagates out, leaving files 0..N-1 re-encrypted with the new passphrase and N..end with the old. The `finally` block can also delete both old and new `.age` files if `rm(ageFile)` succeeds but `rename(tmpNewAge, ageFile)` fails. No rollback mechanism exists.
- **Fix:** Two-phase approach: (1) decrypt all to temp, re-encrypt all to `.new` files; (2) atomic rename pass replacing originals. If any step fails, originals remain intact. Track failures and abort before commit if any file failed.
- **Dependencies:** Fix 1.3

### Fix 1.5: Dead code — src/lockfile.ts and tests/lockfile.test.ts
- **Agent:** dead-code-scanner, scope-intent-verifier, spec-checker
- **File:** src/lockfile.ts, tests/lockfile.test.ts
- **Problem:** `src/lockfile.ts` defines an unused `Lockfile` class with a different API (async `acquire()`/`release()`) from the real implementation at `src/lockfile/lockfile.ts` (static `tryAcquire()`). Tests at `tests/lockfile.test.ts` test the dead module, providing false coverage confidence.
- **Fix:** Delete `src/lockfile.ts` and `tests/lockfile.test.ts`.
- **Dependencies:** None

### Fix 1.6: Dead code — src/commands/logs.ts
- **Agent:** wiring-inspector, scope-intent-verifier, spec-checker
- **File:** src/commands/logs.ts
- **Problem:** `LogsCommand` reads git commit history but is never imported. The CLI `logs` command uses `syncLogger.readRecent()` directly. Two competing implementations for the same feature.
- **Fix:** Delete `src/commands/logs.ts`.
- **Dependencies:** None

### Fix 1.7: JSON.parse returns unvalidated ClaudefyConfig
- **Agent:** type-soundness, test-interrogator
- **File:** src/config/config-manager.ts:62
- **Problem:** `JSON.parse(raw)` returns `any`, implicitly cast to `ClaudefyConfig`. A corrupt or manually edited config missing required fields (`machineId`, `backend.url`) silently produces `undefined` everywhere, causing confusing downstream crashes.
- **Fix:** Add a runtime validator `isClaudefyConfig(obj: unknown): obj is ClaudefyConfig` that checks all required fields. Call it before returning from `load()`. Apply the same pattern to `getLinks()`, `getSyncFilter()`, and `loadManifest()`.
- **Dependencies:** None

### Fix 1.8: ConfigManager.set double cast bypasses type system
- **Agent:** type-soundness
- **File:** src/config/config-manager.ts:86
- **Problem:** `config as unknown as Record<string, unknown>` escapes all type checking. Writing arbitrary keys with arbitrary values can silently corrupt the config invariant.
- **Fix:** After mutation, call the `isClaudefyConfig` validator (from Fix 1.7) before saving. Throw if validation fails.
- **Dependencies:** Fix 1.7

### Fix 1.9: pull.ts executeLocked is 413-line god function
- **Agent:** code-quality-auditor
- **File:** src/commands/pull.ts:72-484
- **Problem:** 10+ distinct responsibilities in one function. Deep nesting (>4 levels with `do/while(false)`). Extremely hard to read, test, or modify safely.
- **Fix:** Extract into private methods: `handleDryRun()`, `applyOverrideIfDetected()`, `decryptTempDir()`, `remapPathsInTempDir()`, `stripDangerousKeys()`, `copyTempDirToClaudeDir()`, `mergeClaudeJson()`. Orchestrator becomes ~50 lines.
- **Dependencies:** Fix 1.1 (DANGEROUS_KEYS extraction)

### Fix 1.10: push.ts executeLocked is 283-line god function
- **Agent:** code-quality-auditor
- **File:** src/commands/push.ts:73-355
- **Problem:** Same god-function issue. Encryption mode dispatch and secret-scan pipeline interleaved inline.
- **Fix:** Extract `runDryRun()`, `encryptFlaggedFiles()`, `runSecretScan()`, `updateManifestAndPush()`.
- **Dependencies:** None

---

## Warnings — Should Fix

### Fix 2.1: git-adapter push/merge errors silently swallowed
- **Agent:** silent-failure-hunter
- **File:** src/git-adapter/git-adapter.ts:127-149
- **Problem:** Push failure (line 127) and merge-to-main failure (line 137) both use `catch` with no error variable. Error reason is discarded; callers cannot distinguish network failure from merge conflict from permissions error. `rotate-passphrase` doesn't even check `result.pushed`.
- **Fix:** Capture `catch (error)` and store `(error as Error).message` on `CommitResult` (add `pushError?: string`, `mergeError?: string`). Log errors before returning.

### Fix 2.2: withLock silently returns for init/join (exit 0)
- **Agent:** wiring-inspector, silent-failure-hunter, product-thinker
- **File:** src/lockfile/lockfile.ts:105-118
- **Problem:** When lock acquisition fails, `withLock` returns `undefined` (no throw, no exit code). For `init`/`join`, the user sees exit 0 with nothing initialized.
- **Fix:** `withLock` should throw or return a boolean. For critical commands (init/join), throw on lock contention. At minimum, set `process.exitCode = 1`.

### Fix 2.3: No test for all 6 DANGEROUS_KEYS stripped on pull
- **Agent:** test-interrogator
- **File:** tests/commands/pull.test.ts
- **Problem:** Only `hooks` stripping is tested. 5 other keys (mcpServers, env, permissions, allowedTools, apiKeyHelper) have zero test coverage. A regression removing any key from the array would go undetected.
- **Fix:** Add test pushing settings.json with all 6 keys, pull, assert each is absent.

### Fix 2.4: No test for path-containment/symlink injection guards
- **Agent:** test-interrogator
- **File:** tests/commands/pull.test.ts
- **Problem:** Path-escape and symlink guards in pull have no test coverage. A broken guard could allow writing outside `~/.claude/`.
- **Fix:** Add tests injecting symlinks and `../` entries into the store, verify they are skipped.

### Fix 2.5: --only and --dry-run flags have zero test coverage
- **Agent:** test-interrogator
- **File:** tests/commands/push.test.ts, tests/commands/pull.test.ts
- **Fix:** Add tests for both flags on both commands.

### Fix 2.6: rotate-passphrase has zero test coverage
- **Agent:** test-interrogator
- **File:** (missing) tests/commands/rotate-passphrase.test.ts
- **Fix:** Create test file with: correct rotation, wrong old passphrase, partial failure atomicity, branch correctness.

### Fix 2.7: Non-atomic JSON writes can corrupt config/manifest on crash
- **Agent:** database-auditor, code-quality-auditor
- **File:** src/config/config-manager.ts:157-165, src/machine-registry/machine-registry.ts:100
- **Problem:** `writeFile` truncates then writes. A crash mid-write leaves empty/partial JSON.
- **Fix:** Extract `atomicWriteJson(path, data)` that writes to `path.tmp` then `rename`. Apply to `saveConfig`, `saveLinks`, `saveSyncFilter`, `saveManifest`.

### Fix 2.8: --skip-secret-scan bypasses all protection (unauthenticated flag)
- **Agent:** security-auditor, auth-flow-verifier
- **File:** src/cli.ts:65, src/commands/override.ts:60
- **Problem:** Public CLI flag disables the only layer preventing secrets from entering the git store in plaintext. Override unconditionally sets it true.
- **Fix:** Gate behind confirmation prompt, or disallow when `encryption.mode === "reactive"` and `encryption.enabled`.

### Fix 2.9: Passphrase echoed on non-TTY stdin
- **Agent:** auth-flow-verifier, security-auditor
- **File:** src/encryptor/passphrase.ts:76-96
- **Fix:** When `hidden && !process.stdin.isTTY`, throw error requiring `CLAUDEFY_PASSPHRASE` env var.

### Fix 2.10: Backup pruning maxCount/maxAgeDays never enforced
- **Agent:** spec-checker, product-thinker, test-interrogator
- **File:** src/backup-manager/backup-manager.ts
- **Fix:** Add `prune(maxCount, maxAgeDays)` method, call after backup creation in pull/restore.

### Fix 2.11: claude-json-sync.json leaked into ~/.claude/ by pull
- **Agent:** logic-auditor, product-thinker, red-team
- **File:** src/commands/pull.ts:381-407
- **Fix:** Add `if (entry.name === "claude-json-sync.json") continue;` in step 7b copy loop.

### Fix 2.12: No config schema version migration
- **Agent:** database-auditor
- **File:** src/config/config-manager.ts:58-69
- **Fix:** Add version check in `load()` that either migrates or throws actionable error.

### Fix 2.13: Multiple unvalidated JSON.parse casts
- **Agent:** type-soundness
- **Files:** src/logger.ts:67, src/update-check.ts:78, src/commands/pull.ts:507, src/lockfile/lockfile.ts:46
- **Fix:** Add type guards before casting: `isLogEntry()`, validate npm response shape, validate OverrideMarker, validate LockInfo.

### Fix 2.14: pullAndMergeMain merge failure leaves repo on wrong branch
- **Agent:** silent-failure-hunter, red-team
- **File:** src/git-adapter/git-adapter.ts:179-184, 136-149
- **Fix:** Capture error in merge catch. Ensure finally checkout to machine branch succeeds or throws clear error.

### Fix 2.15: ensureMainBranch setup failures silently ignored
- **Agent:** silent-failure-hunter
- **File:** src/git-adapter/git-adapter.ts:260-266
- **Fix:** Log warnings for push and set-head failures during store initialization.

### Fix 2.16: checkOverrideOnMain duplicated parser without validation
- **Agent:** contract-verifier, type-soundness
- **File:** src/commands/pull.ts:503-511
- **Fix:** Use `GitAdapter.checkOverrideMarker` or extract shared validator. Add type guard.

### Fix 2.17: Duplicated code across push/pull/diff
- **Agent:** code-quality-auditor
- **Files:** push.ts, pull.ts, diff.ts
- **Fix:** Extract `printDiffLines()` to diff-utils. Extract `stripAgeExtensionsInPlace()` to diff-utils. Extract `copyStoreDir()` in pull.ts.

### Fix 2.18: DANGEROUS_KEYS buried inside function body
- **Agent:** code-quality-auditor
- **File:** src/commands/pull.ts:346
- **Fix:** Promote to module-level constant: `const SETTINGS_KEYS_STRIPPED_ON_PULL = [...] as const;`

### Fix 2.19: claude-json-sync extract/merge swallow parse errors
- **Agent:** silent-failure-hunter
- **File:** src/claude-json-sync/claude-json-sync.ts:21-65
- **Fix:** Capture error, include message in warning. Rethrow non-SyntaxError (I/O errors).

### Fix 2.20: N+1 lstat calls in SyncFilter.classify
- **Agent:** database-auditor
- **File:** src/sync-filter/sync-filter.ts:18-31
- **Fix:** Use `Promise.all` to parallelize lstat calls.

### Fix 2.21: arrayMerge primitive classification uses only first element
- **Agent:** logic-auditor
- **File:** src/merger/merger.ts:11
- **Fix:** Check all elements: `source.every(item => typeof item !== "object" || item === null)`.

### Fix 2.22: Secret scanner pattern only matches JSON format
- **Agent:** security-auditor
- **File:** src/secret-scanner/scanner.ts:29-33
- **Fix:** Add patterns for `.env` assignments, YAML secrets, and JS/TS const assignments.

### Fix 2.23: LineEncryptor frequency analysis (same AD for all lines in file)
- **Agent:** security-auditor
- **File:** src/encryptor/line-encryptor.ts
- **Fix:** Include line index in the AD: `ad = filePath + ":" + lineIndex`.

### Fix 2.24: Pull dry-run omits unknown store items from diff
- **Agent:** logic-auditor
- **File:** src/commands/pull.ts:97-143
- **Fix:** Also copy `storeUnknownDir` into diff comparison.

### Fix 2.25: Encrypted file count reported higher than actual
- **Agent:** logic-auditor
- **File:** src/commands/push.ts:288-312
- **Fix:** Track `encryptedCount` inside loop, report that instead of `filesToEncrypt.size`.

### Fix 2.26: DiffCommand test only checks constructor
- **Agent:** test-interrogator
- **File:** tests/commands/diff.test.ts
- **Fix:** Add test that initializes store, modifies file, runs diff, verifies output.

### Fix 2.27: deepMergeJson not tested with null values
- **Agent:** test-interrogator
- **File:** tests/merger/merger.test.ts
- **Fix:** Add edge-case tests with null array elements and null-valued keys.

### Fix 2.28: git-adapter push failure untested
- **Agent:** test-interrogator
- **File:** tests/git-adapter/git-adapter.test.ts
- **Fix:** Add test simulating push rejection, assert `result.pushed === false`.

### Fix 2.29: normalizeContent conditional dispatch on filename strings
- **Agent:** code-quality-auditor
- **File:** src/commands/push.ts:394
- **Fix:** Use a registry map: `const NORMALIZERS: Record<string, Function> = { ... }`.

### Fix 2.30: hook-manager index signature permits unsound access
- **Agent:** type-soundness
- **File:** src/hook-manager/hook-manager.ts:14
- **Fix:** Type JSON.parse result as `unknown`, add structural guard before casting to ClaudeSettings.

---

## Improvements — Nice to Have

### Fix 3.1: docs/architecture.md missing 7 implemented modules
- **Agent:** scope-intent-verifier
- **Fix:** Add entries for logger, lockfile/, diff-utils/, claude-json-sync/, update-check, output, and missing commands.

### Fix 3.2: status/machines/links output raw JSON
- **Agent:** product-thinker
- **Fix:** Add human-readable default output with `--json` flag.

### Fix 3.3: No machine unregister command
- **Agent:** product-thinker
- **Fix:** Add `claudefy machines remove <machineId>`.

### Fix 3.4: hooks install/remove produce no success feedback
- **Agent:** product-thinker
- **Fix:** Add `output.success("Auto-sync hooks installed/removed.")`.

### Fix 3.5: No import command to complement export
- **Agent:** product-thinker
- **Fix:** Add `claudefy import <path>` that extracts export archive into `~/.claude/`.

### Fix 3.6: push/pull --dry-run exit code 1 on changes
- **Agent:** product-thinker
- **Fix:** Use exit 0 by default; add `--exit-code` flag for non-zero on changes (like `git diff --exit-code`).

### Fix 3.7: config get prints credential-bearing URLs
- **Agent:** security-auditor
- **Fix:** Redact `user:password@` segments from URLs before printing.

### Fix 3.8: doctor.ts logs full remote URL
- **Agent:** security-auditor
- **Fix:** Scrub credentials from URL before display.

### Fix 3.9: _underscore prefix inconsistent with private keyword
- **Agent:** code-quality-auditor
- **File:** src/encryptor/encryptor.ts:62
- **Fix:** Rename to `encryptDirRecursive` and `decryptDirRecursive`.

### Fix 3.10: Single-letter variables l/c in update-check
- **Agent:** code-quality-auditor
- **File:** src/update-check.ts:46
- **Fix:** Rename to `latestSegments` and `currentSegments`.

### Fix 3.11: register/conditionalRegister duplicate logic
- **Agent:** code-quality-auditor
- **File:** src/machine-registry/machine-registry.ts:25
- **Fix:** Implement shared `upsertMachine()` helper.

### Fix 3.12: SecretScanner constructor type mismatch
- **Agent:** contract-verifier
- **File:** src/secret-scanner/scanner.ts:45
- **Fix:** Change to `constructor(customPatterns?: CustomPattern[])`.

### Fix 3.13: package.json require asserted differently in two files
- **Agent:** type-soundness
- **File:** src/index.ts:8, src/cli.ts:20
- **Fix:** Use shared `PackageJson` type or JSON import.

### Fix 3.14: replaceInValues<T> unconstrained generic
- **Agent:** type-soundness
- **File:** src/path-mapper/path-mapper.ts:81
- **Fix:** Constrain to known input types or use `unknown` return.

### Fix 3.15: merger array dedup casts without narrowing
- **Agent:** type-soundness
- **File:** src/merger/merger.ts:25-27
- **Fix:** Add `typeof item === "object" && item !== null` guard before cast.

### Fix 3.16: stdout.write monkey-patch not restored on exception
- **Agent:** security-auditor, type-soundness
- **File:** src/encryptor/passphrase.ts:77-83
- **Fix:** Wrap in try/finally that always restores `process.stdout.write = origWrite`.

### Fix 3.17: SyncFilter.classify ENOENT between readdir and lstat
- **Agent:** logic-auditor
- **File:** src/sync-filter/sync-filter.ts:24
- **Fix:** Wrap `lstat` in try-catch; on `ENOENT`, continue.

### Fix 3.18: pull.ts project directory rename collision
- **Agent:** logic-auditor
- **File:** src/commands/pull.ts:309-322
- **Fix:** Collect all (src, dest) pairs first, check for collisions, then apply.

### Fix 3.19: JoinCommand hostname collision across users
- **Agent:** red-team
- **File:** src/commands/join.ts:56-65
- **Fix:** Include additional identity signals or confirm reuse with user.

---

## Dependency Map

```
Fix 1.7 (config validation) <- Fix 1.8 (ConfigManager.set)
Fix 1.3 (ensureMachineBranch) <- Fix 1.4 (rotation atomicity)
Fix 1.1 (project settings stripping) <- Fix 1.9 (pull refactor)
Fix 1.5 + 1.6 (dead code) — independent, do first
Fix 2.7 (non-atomic writes) — independent, do early
Fix 2.17 (dedup code) <- Fix 1.9 + 1.10 (refactors)
```

## Next Steps
`/ace-enrich --plan .ace-audit/FIX-PLAN.md`
`/ace-implement --plan .ace-audit/FIX-PLAN.md`
