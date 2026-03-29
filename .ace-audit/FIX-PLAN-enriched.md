# Ace Audit — Enriched Fix Plan

**Generated:** 2026-03-29
**Project:** claudefy
**Scope:** Entire codebase (110 files, ~17,225 lines)
**Enrichment:** Hard Contracts + Quality Briefs + Risk Levels for all 49 fix items
**Checkpoint mode:** comprehensive

---

## Wave 1 — Dead Code + Atomic Writes (no dependencies)

### Step 1.5: Delete Dead Code — src/lockfile.ts and tests/lockfile.test.ts
### Risk Level: standard
### Hard Contracts
1. `src/lockfile.ts` must not exist — `test ! -f src/lockfile.ts`
2. `tests/lockfile.test.ts` must not exist — `test ! -f tests/lockfile.test.ts`
3. No import of `"../lockfile.js"` (without `/lockfile/`) in any src file — `grep -rn '"../lockfile.js"' src/ --include="*.ts"` returns 0 matches
4. `npm run build` exits 0
5. `npm run test` exits 0
### Quality Brief
Surgical deletion of provably dead code. The real lockfile at `src/lockfile/lockfile.ts` and its tests at `tests/lockfile/lockfile.test.ts` must remain untouched. No new code.

---

### Step 1.6: Delete Dead Code — src/commands/logs.ts
### Risk Level: standard
### Hard Contracts
1. `src/commands/logs.ts` must not exist — `test ! -f src/commands/logs.ts`
2. No import of `commands/logs` in any src file — `grep -rn "commands/logs" src/ --include="*.ts"` returns 0 matches
3. The inline `logs` command in `src/cli.ts` must still exist — `grep -n "syncLogger" src/cli.ts` returns at least 1 match
4. `npm run build` exits 0
5. `npm run test` exits 0
### Quality Brief
Delete the orphaned LogsCommand that reads git history. The CLI's inline logs handler (reading from syncLogger) is the correct implementation per the spec.

---

### Step 2.7: Atomic JSON Writes — config-manager and machine-registry
### Risk Level: high
### Hard Contracts
1. `saveConfig`, `saveLinks`, `saveSyncFilter` in `src/config/config-manager.ts` must use write-to-tmp-then-rename — `grep -n "\.tmp" src/config/config-manager.ts` returns at least 3 matches
2. `saveManifest` in `src/machine-registry/machine-registry.ts` must use write-to-tmp-then-rename — `grep -n "\.tmp" src/machine-registry/machine-registry.ts` returns at least 1 match
3. All `.tmp` writes use the same parent directory as destination (same-device rename) — no `os.tmpdir()` or `/tmp/` used
4. `npm run build` exits 0
5. `npm run test` exits 0
### Quality Brief
Write to `<dest>.tmp` then `rename()` for POSIX atomicity. The `.tmp` file must be in the same directory as the destination. Cleanup of `.tmp` on error must be in a `finally` block. The `rename` import from `node:fs/promises` must be added.

---

## Wave 2 — Security + Type Safety Foundations (no dependencies)

### Step 1.1: DANGEROUS_KEYS stripping for project-level settings.json
### Risk Level: high
### Hard Contracts
1. After copying projects/ directory in pull.ts, project-level settings.json files must have DANGEROUS_KEYS stripped — `grep -n "stripDangerousKeys\|DANGEROUS_KEYS.*project\|projects.*settings.*strip" src/commands/pull.ts` returns at least 1 match
2. DANGEROUS_KEYS constant must be at module level (not inside function) — `grep -n "^const.*DANGEROUS_KEYS\|^export const.*DANGEROUS_KEYS" src/commands/pull.ts` returns at least 1 match
3. The strip must apply recursively to all `settings.json` files inside `projects/` subdirectories — `grep -n "readdir\|walkDir\|settings\.json.*projects\|projects.*settings" src/commands/pull.ts` returns at least 1 match in the stripping context
4. `npm run build` exits 0
5. `npm run test` exits 0
### Quality Brief
This is the highest-priority security fix. An attacker with remote write access can inject hooks/mcpServers into per-project settings for arbitrary command execution. The strip must happen AFTER the recursive copy and BEFORE any file is written to `~/.claude/`. The same DANGEROUS_KEYS array used for top-level settings must be reused.

---

### Step 1.2: decryptDirectory preserves .age files on failure
### Risk Level: high
### Hard Contracts
1. The catch block in `_decryptDirRecursive` in `src/encryptor/encryptor.ts` must NOT delete `.age` files on decryption failure — `grep -A5 "catch" src/encryptor/encryptor.ts` in the decrypt method must not show `rm(fullPath)` unconditionally
2. Decryption failures must be counted or collected — `grep -n "failCount\|failures\|skipped\|decryptError" src/encryptor/encryptor.ts` returns at least 1 match
3. If ALL files fail decryption, the method must throw (indicating wrong passphrase) — `grep -n "throw.*passphrase\|throw.*decrypt\|all.*fail" src/encryptor/encryptor.ts` returns at least 1 match
4. `npm run build` exits 0
5. `npm run test` exits 0
6. A test for wrong-passphrase behavior must exist — `grep -n "wrong.*pass\|incorrect.*pass" tests/encryptor/encryptor.test.ts` returns at least 1 match
### Quality Brief
Only delete `.age` files on SUCCESSFUL decryption. On failure, preserve the file and count the error. If all files fail, throw a clear "wrong passphrase" error. Individual failures should warn but continue (for pre-existing non-claudefy .age files).

---

### Step 1.3: rotate-passphrase add ensureMachineBranch
### Risk Level: high
### Hard Contracts
1. `src/commands/rotate-passphrase.ts` must call `ensureMachineBranch` after `initStore` — `grep -n "ensureMachineBranch" src/commands/rotate-passphrase.ts` returns at least 1 match
2. The `ensureMachineBranch` call must appear before `commitAndPush` — verify line ordering with `grep -n "ensureMachineBranch\|commitAndPush" src/commands/rotate-passphrase.ts`
3. `npm run build` exits 0
4. `npm run test` exits 0
### Quality Brief
One-line fix. Add `await gitAdapter.ensureMachineBranch(config.machineId);` after `initStore()`, matching the pattern in push.ts and pull.ts.

---

### Step 1.7: Config validation — runtime type guard for ClaudefyConfig
### Risk Level: high
### Hard Contracts
1. A validation function (e.g., `validateConfig` or `isClaudefyConfig`) must exist in `src/config/config-manager.ts` — `grep -n "validateConfig\|isClaudefyConfig\|function validate" src/config/config-manager.ts` returns at least 1 match
2. `load()` must call the validator before returning — `grep -n "validateConfig\|isClaudefyConfig" src/config/config-manager.ts` returns at least 2 matches (definition + call in load)
3. The validator must check `backend.url`, `machineId`, and `version` — `grep -n "backend\|machineId\|version" src/config/config-manager.ts` returns at least 3 matches in the validator
4. Invalid config must throw with field name in message — `grep -n "throw new Error" src/config/config-manager.ts` returns at least 1 match in the validator
5. Tests must cover missing required fields — `grep -n "missing.*backend\|missing.*machineId\|invalid.*config" tests/config/config-manager.test.ts` returns at least 1 match
6. `npm run build` exits 0
7. `npm run test` exits 0
### Quality Brief
Fail-fast validation at the config-load boundary. Check required fields are present and of correct type. Error messages must include the file path and the missing field name. Do not reject valid optional fields.

---

## Wave 3 — Rotation Fix + Error Handling (depends on Wave 2)

### Step 1.4: rotate-passphrase two-phase atomic rotation
### Risk Level: high
### Hard Contracts
1. The rotation must use a two-phase approach: all `.new` files created first, then atomic rename pass — `grep -n "\.new\|phase.*1\|phase.*2\|rename.*pass" src/commands/rotate-passphrase.ts` returns at least 2 matches
2. If any file fails in phase 1 (decrypt/re-encrypt), NO renames happen and originals are preserved — `grep -n "abort\|rollback\|throw.*partial\|failed.*rotation" src/commands/rotate-passphrase.ts` returns at least 1 match
3. Plaintext files must be cleaned up in finally — `grep -n "finally\|cleanup\|rm.*plain" src/commands/rotate-passphrase.ts` returns at least 1 match
4. The error message on partial failure must indicate how many files succeeded — `grep -n "rotated.*of\|files.*before.*failure" src/commands/rotate-passphrase.ts` returns at least 1 match
5. `npm run build` exits 0
6. `npm run test` exits 0
### Quality Brief
Two-phase: (1) decrypt all to temp + re-encrypt all to `.new` files; (2) atomic rename pass replacing originals. If phase 1 fails, all originals remain. If phase 2 fails mid-way, some files have new passphrase but originals are gone (POSIX rename is atomic per-file). Clean up all plaintext in finally.

---

### Step 1.8: ConfigManager.set validates after mutation
### Risk Level: high
### Hard Contracts
1. `set()` must call the validator (from Step 1.7) after mutation and before saving — `grep -n "validateConfig\|isClaudefyConfig" src/config/config-manager.ts` returns at least 1 match inside `set`
2. If validation fails after mutation, the config must NOT be saved — verify the throw happens before `saveConfig`
3. `npm run build` exits 0
4. `npm run test` exits 0
### Quality Brief
After the double-cast mutation, validate the result conforms to ClaudefyConfig before saving. This catches cases where `set("encryption.mode", 123)` would silently corrupt the config type.

---

### Step 2.1: git-adapter capture push/merge errors
### Risk Level: high
### Hard Contracts
1. `CommitResult` must have `pushError?: string` and `mergeError?: string` fields — `grep -n "pushError\|mergeError" src/git-adapter/git-adapter.ts` returns at least 2 matches
2. The push catch block must capture the error — `grep -n "pushError.*=\|catch.*err\|catch.*error" src/git-adapter/git-adapter.ts` returns at least 1 match in the push catch
3. Callers (push.ts) must log the error when `!pushed` — `grep -n "pushError\|mergeError" src/commands/push.ts` returns at least 1 match
4. `npm run build` exits 0
5. `npm run test` exits 0
### Quality Brief
Add optional error fields to CommitResult. Capture `(error as Error).message` in each catch. Callers should include the error in their warning output.

---

### Step 2.2: withLock throws for init/join
### Risk Level: high
### Hard Contracts
1. `withLock` or the init/join callers must throw or set non-zero exit code on lock contention — `grep -n "throw\|process.exitCode\|exitCode.*1" src/lockfile/lockfile.ts` or `src/commands/init.ts` returns at least 1 match
2. `npm run build` exits 0
3. `npm run test` exits 0
### Quality Brief
For non-critical commands (push/pull), silent skip is acceptable. For init/join, lock contention must surface as an error since the command's entire purpose is skipped. Either `withLock` returns a boolean and callers throw, or `withLock` accepts a `critical` flag.

---

### Step 2.11: claude-json-sync.json skip in pull copy loop
### Risk Level: standard
### Hard Contracts
1. The copy loop in pull.ts step 7b must skip `claude-json-sync.json` — `grep -n "claude-json-sync" src/commands/pull.ts` returns at least 1 match with `continue`
2. `npm run build` exits 0
3. `npm run test` exits 0
### Quality Brief
Add `if (entry.name === "claude-json-sync.json") continue;` alongside the existing `settings.json` skip. This prevents the internal store artifact from leaking into `~/.claude/`.

---

### Step 2.18: DANGEROUS_KEYS promoted to module-level constant
### Risk Level: standard
### Hard Contracts
1. `DANGEROUS_KEYS` (or `SETTINGS_KEYS_STRIPPED_ON_PULL`) declared at module level with `as const` — `grep -n "^const.*DANGEROUS\|^const.*STRIPPED\|^export const.*DANGEROUS" src/commands/pull.ts` returns at least 1 match
2. The constant must not appear inside any function body — verify zero indentation on declaration line
3. `npm run build` exits 0
4. `npm run test` exits 0
### Quality Brief
Move from inside executeLocked to module scope. Use `as const` for immutability. Add a comment referencing the CLAUDE.md spec.

---

## Wave 4 — God Function Extraction + Dedup (depends on Waves 1-3)

### Step 1.9: Extract pull.ts dry-run into private method
### Risk Level: standard
### Hard Contracts
1. A private method for dry-run must exist — `grep -n "private.*DryRun\|private.*dryRun" src/commands/pull.ts` returns at least 1 match
2. The `if (options.dryRun)` branch must delegate to the method — `grep -A5 "if.*dryRun" src/commands/pull.ts` shows a method call within 5 lines
3. `npm run build` exits 0
4. `npm run test` exits 0
### Quality Brief
Extract-method refactor. The new method owns temp-directory lifecycle including finally cleanup.

---

### Step 1.10: Extract push.ts dry-run into private method
### Risk Level: standard
### Hard Contracts
1. A private method for dry-run must exist — `grep -n "private.*DryRun\|private.*dryRun" src/commands/push.ts` returns at least 1 match
2. `npm run build` exits 0
3. `npm run test` exits 0
### Quality Brief
Symmetric with Step 1.9. Extract push dry-run logic.

---

### Step 2.17: Extract shared utilities (printDiffLines, stripAgeExtensions)
### Risk Level: standard
### Hard Contracts
1. `printDiffLines` or equivalent must exist in `src/diff-utils/diff-utils.ts` or `src/output.ts` — `grep -rn "printDiffLines\|printDiff\|displayDiff" src/diff-utils/ src/output.ts` returns at least 1 match
2. Duplicated diff display in push.ts, pull.ts, diff.ts must use the shared function — `grep -rn "printDiffLines\|printDiff\|displayDiff" src/commands/push.ts src/commands/pull.ts src/commands/diff.ts` returns at least 3 matches
3. `npm run build` exits 0
4. `npm run test` exits 0
### Quality Brief
DRY extraction. The shared function accepts a diff result and outputs colored lines. Each caller imports from the shared location.

---

## Wave 5 — Test Gaps (depends on Waves 1-4)

### Step 2.3: Test all 6 DANGEROUS_KEYS stripped
### Risk Level: standard
### Hard Contracts
1. Test must assert all 6 keys are absent after pull — `grep -n "mcpServers\|allowedTools\|apiKeyHelper\|permissions.*Undefined\|env.*Undefined" tests/commands/pull.test.ts` returns at least 4 matches
2. `npm run test` exits 0
### Quality Brief
Push settings.json with all 6 dangerous keys populated, pull, assert each is `undefined` in result.

---

### Step 2.4: Test path-containment/symlink guards
### Risk Level: standard
### Hard Contracts
1. Test with symlink in store — `grep -n "symlink\|symlinkSync\|createSymlink" tests/commands/pull.test.ts` returns at least 1 match
2. Test with `../` path traversal entry — `grep -n "\.\./\|traversal\|escape" tests/commands/pull.test.ts` returns at least 1 match
3. `npm run test` exits 0
### Quality Brief
Use real temp directories. Inject symlinks and `../`-escaped entries into store. Verify they are skipped and not written to ~/.claude.

---

### Step 2.5: Test --only and --dry-run flags
### Risk Level: standard
### Hard Contracts
1. Push test with `dryRun: true` — `grep -n "dryRun.*true\|dry.run" tests/commands/push.test.ts` returns at least 1 match
2. Pull test with `dryRun: true` — `grep -n "dryRun.*true\|dry.run" tests/commands/pull.test.ts` returns at least 1 match
3. Push test with `only:` — `grep -n "only:" tests/commands/push.test.ts` returns at least 1 match
4. `npm run test` exits 0
### Quality Brief
Dry-run tests assert ~/.claude is unchanged. --only tests assert only the named item is synced.

---

### Step 2.6: Test rotate-passphrase
### Risk Level: high
### Hard Contracts
1. `tests/commands/rotate-passphrase.test.ts` must exist
2. Test for correct rotation — `grep -n "rotate\|re-encrypt" tests/commands/rotate-passphrase.test.ts` returns at least 1 match
3. Test for wrong old passphrase — `grep -n "wrong.*pass\|incorrect.*pass" tests/commands/rotate-passphrase.test.ts` returns at least 1 match
4. Test that no plaintext remains — `grep -n "existsSync\|not.*exist\|plaintext" tests/commands/rotate-passphrase.test.ts` returns at least 1 match
5. `npm run test` exits 0
### Quality Brief
Use real crypto, not mocks. Test: successful rotation, wrong passphrase rejection, no plaintext residue.

---

### Step 2.26: Test DiffCommand behavior
### Risk Level: standard
### Hard Contracts
1. `tests/commands/diff.test.ts` must have a behavioral test — `grep -n "Modified\|Added\|Deleted\|diff" tests/commands/diff.test.ts` returns at least 1 match beyond constructor test
2. `npm run test` exits 0
### Quality Brief
Initialize store, modify file, run diff, verify output includes the modified file.

---

### Step 2.27: Test deepMergeJson with null values
### Risk Level: standard
### Hard Contracts
1. `tests/merger/merger.test.ts` must test null array elements — `grep -n "null" tests/merger/merger.test.ts` returns at least 1 match in a deepMerge context
2. `npm run test` exits 0
### Quality Brief
Test `deepMergeJson({key: [1,2]}, {key: null})` and `deepMergeJson({key: null}, {key: "val"})`.

---

### Step 2.28: Test git-adapter push failure
### Risk Level: standard
### Hard Contracts
1. `tests/git-adapter/git-adapter.test.ts` must test push failure — `grep -n "pushed.*false\|push.*fail\|push.*reject" tests/git-adapter/git-adapter.test.ts` returns at least 1 match
2. `npm run test` exits 0
### Quality Brief
Simulate push rejection (diverged remote). Assert `result.pushed === false` and `result.committed === true`.

---

## Wave 6 — Remaining Warnings

### Step 2.8: --skip-secret-scan gating
### Risk Level: standard
### Hard Contracts
1. When `encryption.mode === "reactive"` and `encryption.enabled`, `--skip-secret-scan` must warn or be disallowed — `grep -n "skip.*secret.*reactive\|reactive.*skip\|warn.*skip" src/commands/push.ts` returns at least 1 match
2. `npm run build` exits 0
3. `npm run test` exits 0

### Step 2.9: Passphrase non-TTY error
### Risk Level: standard
### Hard Contracts
1. `prompt()` in passphrase.ts must throw when `hidden && !process.stdin.isTTY` — `grep -n "isTTY\|throw.*non.*interactive\|throw.*CLAUDEFY_PASSPHRASE" src/encryptor/passphrase.ts` returns at least 1 match
2. `npm run build` exits 0
3. `npm run test` exits 0

### Step 2.10: Backup pruning implementation
### Risk Level: standard
### Hard Contracts
1. `BackupManager` must have a `prune` method — `grep -n "prune\|pruneOldBackups" src/backup-manager/backup-manager.ts` returns at least 1 match
2. `prune` must respect `maxCount` and `maxAgeDays` — `grep -n "maxCount\|maxAgeDays" src/backup-manager/backup-manager.ts` returns at least 2 matches
3. Test for pruning — `grep -n "prune\|maxCount" tests/backup-manager/backup-manager.test.ts` returns at least 1 match
4. `npm run build` exits 0
5. `npm run test` exits 0

### Step 2.12: Config version check
### Risk Level: standard
### Hard Contracts
1. `load()` must check config version — `grep -n "version.*!==\|version.*check\|CURRENT.*VERSION" src/config/config-manager.ts` returns at least 1 match
2. `npm run build` exits 0
3. `npm run test` exits 0

### Step 2.13: Unvalidated JSON.parse type guards
### Risk Level: standard
### Hard Contracts
1. `isLogEntry` or equivalent guard in logger.ts — `grep -n "isLogEntry\|typeof.*level\|typeof.*timestamp" src/logger.ts` returns at least 1 match
2. Override marker validation in pull.ts — `grep -n "typeof.*machine\|typeof.*timestamp" src/commands/pull.ts` returns at least 1 match near `checkOverrideOnMain`
3. LockInfo validation in lockfile.ts — `grep -n "typeof.*pid\|typeof.*startedAt" src/lockfile/lockfile.ts` returns at least 1 match
4. `npm run build` exits 0
5. `npm run test` exits 0

### Step 2.14: pullAndMergeMain capture merge error
### Risk Level: standard
### Hard Contracts
1. Merge catch must capture error — `grep -n "catch.*err\|catch.*error" src/git-adapter/git-adapter.ts` in pullAndMergeMain returns at least 1 match with variable binding
2. `npm run build` exits 0
3. `npm run test` exits 0

### Step 2.15: ensureMainBranch log warnings
### Risk Level: standard
### Hard Contracts
1. Push and set-head failures must log — `grep -n "warn\|log.*error\|catch.*err" src/git-adapter/git-adapter.ts` in ensureMainBranch returns at least 1 match
2. `npm run build` exits 0
3. `npm run test` exits 0

### Step 2.16: checkOverrideOnMain use shared validator
### Risk Level: standard
### Hard Contracts
1. `checkOverrideOnMain` must validate the parsed JSON — `grep -n "typeof.*machine\|OverrideMarker\|validate" src/commands/pull.ts` returns at least 1 match near checkOverrideOnMain
2. `npm run build` exits 0
3. `npm run test` exits 0

### Step 2.19: claude-json-sync error capture
### Risk Level: standard
### Hard Contracts
1. Catch blocks must have error variable — `grep -n "catch (err\|catch (e" src/claude-json-sync/claude-json-sync.ts` returns at least 2 matches
2. Error message included in warning — `grep -n "err.*message\|error.*message" src/claude-json-sync/claude-json-sync.ts` returns at least 1 match
3. `npm run build` exits 0
4. `npm run test` exits 0

### Step 2.20: SyncFilter.classify parallelize lstat
### Risk Level: standard
### Hard Contracts
1. `Promise.all` used for lstat calls — `grep -n "Promise.all" src/sync-filter/sync-filter.ts` returns at least 1 match
2. `npm run build` exits 0
3. `npm run test` exits 0

### Step 2.21: arrayMerge check all elements
### Risk Level: standard
### Hard Contracts
1. `source.every` or equivalent full-array check — `grep -n "every\|all.*typeof\|source\.every" src/merger/merger.ts` returns at least 1 match
2. `npm run build` exits 0
3. `npm run test` exits 0

### Step 2.22: Secret scanner non-JSON patterns
### Risk Level: standard
### Hard Contracts
1. New patterns for env/YAML/JS formats — `grep -n "ENV\|export\|YAML\|yaml\|const.*=\|let.*=" src/secret-scanner/scanner.ts` returns at least 1 match in SECRET_PATTERNS
2. `npm run build` exits 0
3. `npm run test` exits 0

### Step 2.23: LineEncryptor include line index in AD
### Risk Level: high
### Hard Contracts
1. Line index must be part of AD string — `grep -n "lineIndex\|index\|:.*i\b" src/encryptor/line-encryptor.ts` returns at least 1 match in encrypt/decrypt
2. Existing line-encryptor tests must still pass — `npm run test` exits 0
3. `npm run build` exits 0
### Quality Brief
BREAKING CHANGE for existing encrypted JSONL files. Existing ciphertext will not decrypt with new AD. Migration path needed: decrypt all with old AD, re-encrypt with new. Document in fix plan that this requires a full re-encryption pass.

### Step 2.24: Pull dry-run include unknown items
### Risk Level: standard
### Hard Contracts
1. Pull dry-run copies `storeUnknownDir` into comparison — `grep -n "unknownDir\|STORE_UNKNOWN" src/commands/pull.ts` returns at least 1 match in dry-run path
2. `npm run build` exits 0
3. `npm run test` exits 0

### Step 2.25: Fix encrypted file count reporting
### Risk Level: standard
### Hard Contracts
1. Report actual encrypted count, not `filesToEncrypt.size` — `grep -n "encryptedCount\|actualCount" src/commands/push.ts` returns at least 1 match
2. `npm run build` exits 0
3. `npm run test` exits 0

### Step 2.29: normalizeContent registry map
### Risk Level: standard
### Hard Contracts
1. A `NORMALIZERS` map or equivalent — `grep -n "NORMALIZERS\|normalizer.*Map\|normalizer.*Record" src/commands/push.ts` returns at least 1 match
2. `needsNormalization` uses the same map — `grep -n "NORMALIZERS\|normalizer.*has\|normalizer.*in" src/commands/push.ts` returns at least 1 match
3. `npm run build` exits 0
4. `npm run test` exits 0

### Step 2.30: hook-manager type guard for ClaudeSettings
### Risk Level: standard
### Hard Contracts
1. JSON.parse result typed as `unknown` — `grep -n "unknown\|as unknown" src/hook-manager/hook-manager.ts` returns at least 1 match in parse context
2. Structural guard before cast — `grep -n "typeof.*hooks\|Array.isArray.*hooks" src/hook-manager/hook-manager.ts` returns at least 1 match
3. `npm run build` exits 0
4. `npm run test` exits 0

---

## Wave 7 — Improvements

### Step 3.1: Update docs/architecture.md with missing modules
### Risk Level: standard
### Hard Contracts
1. `docs/architecture.md` must mention logger, lockfile, diff-utils, claude-json-sync, update-check, output — `grep -n "logger\|lockfile\|diff-utils\|claude-json-sync\|update-check\|output" docs/architecture.md` returns at least 5 matches
2. `npm run build` exits 0

### Step 3.2-3.4: Human-readable output for status/machines/links + hooks feedback
### Risk Level: standard
### Hard Contracts
1. `claudefy status` must produce formatted output by default — `grep -n "table\|format\|heading\|─" src/cli.ts` returns matches in status section
2. `hooks install/remove` must output success message — `grep -n "success\|installed\|removed" src/cli.ts` returns matches in hooks section
3. `npm run build` exits 0
4. `npm run test` exits 0

### Step 3.5-3.8: URL redaction in config get and doctor
### Risk Level: standard
### Hard Contracts
1. A `redactUrl` or `scrubCredentials` function — `grep -rn "redactUrl\|scrubCredentials\|redact.*url" src/` returns at least 1 match
2. `config get` uses redaction — `grep -n "redact\|scrub" src/cli.ts` returns at least 1 match
3. `doctor.ts` uses redaction — `grep -n "redact\|scrub" src/commands/doctor.ts` returns at least 1 match
4. `npm run build` exits 0
5. `npm run test` exits 0

### Step 3.9: Rename _underscore methods in encryptor
### Risk Level: standard
### Hard Contracts
1. No `_encrypt` or `_decrypt` methods — `grep -n "_encrypt\|_decrypt" src/encryptor/encryptor.ts` returns 0 matches
2. `npm run build` exits 0
3. `npm run test` exits 0

### Step 3.10: Rename l/c variables in update-check
### Risk Level: standard
### Hard Contracts
1. No single-letter `l` or `c` variable — `grep -n "const l \|const c " src/update-check.ts` returns 0 matches
2. `npm run build` exits 0
3. `npm run test` exits 0

### Step 3.11: Dedup register/conditionalRegister
### Risk Level: standard
### Hard Contracts
1. Shared `upsertMachine` helper — `grep -n "upsertMachine\|upsert" src/machine-registry/machine-registry.ts` returns at least 1 match
2. `npm run build` exits 0
3. `npm run test` exits 0

### Step 3.12-3.19: Minor type fixes and improvements
### Risk Level: standard
### Hard Contracts
1. SecretScanner optional param — `grep -n "customPatterns?" src/secret-scanner/scanner.ts` returns at least 1 match
2. Shared PackageJson type — `grep -rn "PackageJson" src/` returns at least 1 match
3. merger array guard — `grep -n "typeof item.*object.*item.*null" src/merger/merger.ts` returns at least 1 match
4. passphrase.ts try/finally for stdout.write restore — `grep -n "finally.*origWrite\|origWrite.*finally" src/encryptor/passphrase.ts` returns at least 1 match
5. SyncFilter ENOENT guard — `grep -n "catch.*ENOENT\|ENOENT\|continue" src/sync-filter/sync-filter.ts` returns at least 1 match
6. `npm run build` exits 0
7. `npm run test` exits 0

---

## Dependency Map

```
Wave 1 (independent) → Wave 2 (independent) → Wave 3 (depends on 2) → Wave 4 (depends on 1-3) → Wave 5 (depends on 1-4) → Wave 6 (independent) → Wave 7 (independent)
```

## Verification Command
```sh
npm run lint && npm run format:check && npm run build && npm run test
```
