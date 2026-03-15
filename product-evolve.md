# Claudefy v2 — Product Requirements Document

**Document version:** 1.0
**Date:** 2026-03-15
**Author:** Code review analysis
**Status:** Draft — ready for implementation planning
**Scope:** Complete audit findings for `@kodrunhq/claudefy` v1.3.4, translated into actionable requirements across 31 issues organized by priority.

---

## 1. Executive Summary

Claudefy is a CLI tool that syncs `~/.claude` across machines via a private git repository. The v1.3 codebase is architecturally sound — 220 passing tests, clean TypeScript/ESM, well-separated modules, thoughtful security layering, and solid documentation. However, the tool's internal model of what `~/.claude` actually contains has fallen behind Claude Code's rapid evolution through 2025–2026. The most important file in a user's Claude Code setup (`CLAUDE.md`) is treated as unknown cargo, critical new directories are unclassified, and several concurrency and correctness bugs exist in the sync pipeline.

This PRD defines 31 issues across 4 priority tiers (5 P0, 9 P1, 10 P2, 7 P3), covering stale classification lists, missing concurrency guards, encryption model gaps, secret scanner false positives, missing CLI commands, and platform support gaps.

---

## 2. Reference: Actual ~/.claude Directory Structure (Claude Code 2.x, March 2026)

This section documents the ground-truth contents of `~/.claude` as observed in Claude Code 2.0–2.1.x, compiled from official Anthropic documentation, community research (samkeen's structural analysis), and the Claude Code settings reference. This is the authoritative reference for all classification decisions in this PRD.

### 2.1 Full Directory Tree

```
~/.claude/
├── CLAUDE.md                     # User-level persistent memory (loaded every session, first 200 lines)
├── MEMORY.md                     # Auto-learned memory (agent writes here, first 200 lines loaded)
├── settings.json                 # Global user settings (permissions, model, hooks)
├── settings.local.json           # Local-only settings (NOT synced, personal overrides)
├── .credentials.json             # API credentials (Linux/Windows only) — NEVER sync
├── history.jsonl                 # Prompt history across all sessions
├── stats-cache.json              # Aggregated usage statistics (machine-specific)
├── package.json                  # npm package metadata for installed tools
│
├── commands/                     # Custom slash commands (markdown with YAML frontmatter)
│   ├── review.md
│   └── ...
├── agents/                       # Custom AI subagents (markdown with YAML frontmatter)
│   └── code-reviewer.md
├── skills/                       # Complex skills with scripts and SKILL.md
│   └── dev-journal/
│       └── SKILL.md
├── plugins/                      # Plugin marketplace and installations
│   ├── cache/
│   ├── config.json
│   ├── installed_plugins.json
│   ├── known_marketplaces.json
│   ├── install-counts-cache.json
│   └── marketplaces/
├── hooks/                        # (Legacy/custom hook scripts)
├── rules/                        # Global rules (loaded alongside CLAUDE.md)
│   └── *.md
├── plans/                        # Plan mode markdown documents (whimsical names)
├── agent-memory/                 # Per-agent persistent memory directories
│
├── projects/                     # Session transcripts per project
│   └── -Users-user-myproject/
│       ├── {uuid}.jsonl          # Main session transcript
│       └── agent-{shortId}.jsonl # Sub-agent transcript
│
├── file-history/                 # File checkpoints for undo/rollback per session
│   └── {sessionId}/
│       └── {contentHash}@v{n}
├── todos/                        # Task lists per session
│   └── {sessionId}-agent-{agentId}.json
├── session-env/                  # Per-session environment variables
│   └── {sessionId}/
├── shell-snapshots/              # Shell environment snapshots
│   └── snapshot-{shell}-{ts}-{rand}.sh
├── debug/                        # Debug logs per session
│   └── {sessionId}.txt
│
├── cache/                        # General cache
├── backups/                      # Backup snapshots
├── paste-cache/                  # Clipboard paste cache
│
├── ide/                          # IDE integration locks
├── statsig/                      # Feature flag cache (Statsig)
├── telemetry/                    # Usage telemetry (if enabled)
│
└── mcp-needs-auth-cache.json     # MCP auth state cache
```

### 2.2 Related File Outside ~/.claude

```
~/.claude.json                    # System-managed state file (NOT inside ~/.claude/)
                                  # Contains: OAuth session, MCP server configs,
                                  # per-project state, feature flags, usage tracking
                                  # NEVER manually edit. Contains secrets (OAuth tokens).
```

### 2.3 Project-Level Files (for reference, NOT synced by claudefy)

```
<project>/
├── CLAUDE.md                     # Project-specific memory
├── CLAUDE.local.md               # Personal project memory (gitignored)
├── .mcp.json                     # Project MCP server config
└── .claude/
    ├── settings.json             # Project shared settings
    ├── settings.local.json       # Project personal settings
    ├── rules/                    # Project-scoped rules
    ├── skills/                   # Project-scoped skills
    ├── agents/                   # Project-scoped agents
    └── commands/                 # Project-scoped commands
```

---

## 3. Issue Registry

### Legend

| Priority | Meaning | SLA |
|----------|---------|-----|
| **P0** | Ship-blocking. Data loss, security hole, or core feature broken. | Before next release |
| **P1** | High value. Significant UX gap, correctness bug, or missing guardrail. | Next 1–2 releases |
| **P2** | Important polish. Missing feature, platform gap, or hardening. | Next 2–4 releases |
| **P3** | Nice-to-have. Quality of life, documentation, minor UX. | Backlog |

---

## 4. P0 Issues (Ship-Blocking)

### P0-01: Update allowlist to match Claude Code 2.x directory structure

**Component:** `src/config/defaults.ts` → `DEFAULT_SYNC_FILTER.allowlist`
**Type:** Bug — stale data
**Severity:** Critical

#### Problem

The current allowlist is:

```ts
allowlist: [
  "commands", "agents", "skills", "hooks", "rules", "plans",
  "plugins", "agent-memory", "projects", "settings.json",
  "history.jsonl", "package.json",
]
```

This is missing `CLAUDE.md` — the single most valuable file in a user's Claude Code setup. It contains user-level persistent memory loaded at the start of every session. Currently, `CLAUDE.md` falls into the "unknown" tier, meaning it gets encrypted and dumped into the `unknown/` store directory with no path normalization applied. A user's primary persistent memory file is treated as unclassified cargo.

Additionally, `MEMORY.md` (the auto-learned agent memory, first 200 lines injected every session) is also missing and falls to unknown tier.

#### Required Changes

Add to **allowlist**:

| Item | Rationale |
|------|-----------|
| `CLAUDE.md` | User-level persistent memory. THE most important file to sync. Loaded every session. |
| `MEMORY.md` | Auto-learned agent memory. First 200 lines injected into system prompt. |

#### Special Handling for CLAUDE.md

`CLAUDE.md` is a file, not a directory. Verify that `SyncFilter.classify()` handles files at the top level correctly (it does — it uses `readdir` and checks `entry.name` against the lists regardless of file vs directory). The push/pull pipeline's `syncItem` also handles top-level files. No structural changes needed, just the allowlist addition.

#### Acceptance Criteria

- `CLAUDE.md` is classified as "allow" tier
- `MEMORY.md` is classified as "allow" tier
- Both files round-trip correctly through push → pull cycle
- Path normalization is applied to `CLAUDE.md` content if it contains absolute paths (unlikely but possible)
- Existing users who previously had these in `unknown/` should see them migrated to `config/` on next push

#### Test Cases

- Unit: `SyncFilter.getTier("CLAUDE.md")` returns `"allow"`
- Unit: `SyncFilter.getTier("MEMORY.md")` returns `"allow"`
- Integration: push with `CLAUDE.md` present → verify it lands in `store/config/CLAUDE.md`, not `store/unknown/CLAUDE.md`

---

### P0-02: Update denylist to match Claude Code 2.x directory structure

**Component:** `src/config/defaults.ts` → `DEFAULT_SYNC_FILTER.denylist`
**Type:** Bug — stale data
**Severity:** Critical

#### Problem

The current denylist is:

```ts
denylist: [
  "cache", "backups", "file-history", "shell-snapshots",
  "paste-cache", "session-env", "tasks", ".credentials.json",
  "mcp-needs-auth-cache.json",
]
```

Multiple directories and files that should NEVER be synced are missing, causing them to fall into the "unknown" tier and get synced (possibly encrypted) to the remote. This wastes storage, bloats the git repo with ephemeral data, and in some cases leaks machine-specific state.

#### Required Changes

Add to **denylist**:

| Item | Rationale |
|------|-----------|
| `settings.local.json` | Explicitly designed by Anthropic to NOT be synced. Contains personal local overrides. The `.local.` convention across Claude Code means "gitignored / not shared." |
| `statsig` | Feature flag cache. Machine-specific. Regenerated automatically. |
| `telemetry` | Usage telemetry directory. Machine-specific. |
| `ide` | IDE integration locks. Machine-specific process state. |
| `debug` | Per-session debug logs (`{sessionId}.txt`). Ephemeral, machine-specific, can be very large. |
| `todos` | Per-session task lists (`{sessionId}-agent-{agentId}.json`). Ephemeral, tied to local sessions. |
| `stats-cache.json` | Aggregated usage metrics. Machine-specific, auto-recomputed. Contains session counts, token usage, etc. that are per-machine. |

#### Rationale for NOT denying `plans/`

Plans are standalone markdown files with whimsical names (e.g., `cosmic-plotting-bunny.md`). They represent architectural decisions and implementation plans. These have cross-machine value and are already in the allowlist. No change needed.

#### Acceptance Criteria

- All 7 new items are classified as "deny" tier
- Existing users who previously synced these items to `unknown/` will stop pushing new changes (old data remains in store until a user runs `override`)
- `settings.local.json` is never synced even if a user adds it to their custom allowlist (add to `HARDCODED_DENYLIST` alongside `.credentials.json`)

#### Implementation Note — `settings.local.json` goes to HARDCODED_DENYLIST

`settings.local.json` should be added to the `HARDCODED_DENYLIST` array in `src/sync-filter/sync-filter.ts`, not just the configurable denylist. This matches the treatment of `.credentials.json` — it's a file that must NEVER be synced regardless of user configuration. The `.local.` naming convention in Claude Code explicitly signals "not for sharing."

```ts
const HARDCODED_DENYLIST = [".credentials.json", "settings.local.json"];
```

#### Test Cases

- Unit: `SyncFilter.getTier("settings.local.json")` returns `"deny"`
- Unit: `SyncFilter.getTier("statsig")` returns `"deny"`
- Unit: `SyncFilter.getTier("debug")` returns `"deny"`
- Unit: `SyncFilter.getTier("todos")` returns `"deny"`
- Unit: `SyncFilter.getTier("ide")` returns `"deny"`
- Unit: `SyncFilter.getTier("telemetry")` returns `"deny"`
- Unit: `SyncFilter.getTier("stats-cache.json")` returns `"deny"`
- Unit: Verify `settings.local.json` is denied even if added to user's custom allowlist (HARDCODED_DENYLIST behavior)

---

### P0-03: Add concurrent sync lockfile protection

**Component:** New module `src/lockfile/lockfile.ts`, integrated into all commands
**Type:** Bug — race condition
**Severity:** Critical

#### Problem

There is no protection against concurrent claudefy operations. The following scenarios are realistic and cause undefined behavior:

1. **Hook race:** `claudefy pull` fires via SessionStart hook while user manually runs `claudefy push` in another terminal.
2. **Parallel sessions:** Two Claude Code sessions start simultaneously, both triggering `claudefy pull` via hooks.
3. **Hook + manual:** User runs `claudefy override --confirm` while a hook-triggered push is in progress.

All of these result in two processes modifying the same git working tree (`~/.claudefy/store/`), the same temp directory (`~/.claudefy/.pull-tmp`), and the same target directory (`~/.claude/`) simultaneously. Outcomes range from git errors to data corruption.

#### Required Changes

Create a PID-based lockfile mechanism:

```
~/.claudefy/.lock
```

**Lock file format:** JSON with `pid`, `command`, `startedAt` fields.

**Behavior:**
1. Before any mutating command (`push`, `pull`, `override`, `init`, `join`), acquire the lock.
2. If lock exists, check if the PID is still alive (`process.kill(pid, 0)`).
3. If PID is dead (stale lock), remove and re-acquire.
4. If PID is alive, print a message and exit with code 0 (not error — hooks should not alarm users).
5. Release lock in a `finally` block and via process exit handlers.

**Timeout:** Lock should have a maximum age (e.g., 10 minutes) as a safety valve against zombie processes.

#### Non-mutating commands that do NOT need the lock

`status`, `links`, `machines`, `doctor`, `config get`, `hooks status` — these are read-only.

#### Acceptance Criteria

- Concurrent `push` + `pull` → second process waits or exits cleanly
- Stale lock from crashed process → auto-cleaned on next run
- Lock released in all exit paths (success, error, signal)
- Hook-triggered operations exit silently (code 0) when locked, not with error output
- Lock file cleaned up on process exit

#### Test Cases

- Unit: Lock acquisition succeeds when no lock exists
- Unit: Lock acquisition fails when another PID holds it and is alive
- Unit: Stale lock (dead PID) is auto-cleaned
- Unit: Lock file is removed after release
- Integration: Two parallel push operations → only one succeeds, other exits cleanly

---

### P0-04: Fix signal handler in pull.ts — process.exit in cleanup prevents finally block

**Component:** `src/commands/pull.ts`, lines ~90–96
**Type:** Bug — incorrect error handling
**Severity:** High

#### Problem

The SIGINT/SIGTERM cleanup handler in `PullCommand.execute()` calls `process.exit(1)` directly:

```ts
const cleanup = () => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Best effort
  }
  process.exit(1);
};
process.once("SIGINT", cleanup);
process.once("SIGTERM", cleanup);
```

If a signal fires after files have been partially copied from the temp directory to `~/.claude/` but before the operation completes, `process.exit(1)` kills the process immediately. The `finally` block that handles temp directory cleanup never runs. More critically, `~/.claude/` may be in a partially-updated state with no way to detect or recover from this.

#### Required Changes

Replace `process.exit(1)` with a flag-based approach:

```ts
let interrupted = false;

const cleanup = (signal: string) => {
  interrupted = true;
  // Re-raise the signal after cleanup to get the correct exit code
  process.once(signal, () => process.exit(128 + (signal === "SIGINT" ? 2 : 15)));
};

process.once("SIGINT", () => cleanup("SIGINT"));
process.once("SIGTERM", () => cleanup("SIGTERM"));
```

Inside the main try block, check `interrupted` at key checkpoints (between copy operations) and bail out early to the `finally` block if set.

Alternatively (simpler): just remove the `process.exit(1)` and let the process terminate naturally. The `finally` block already handles temp dir cleanup. The signal handlers should only ensure temp directory cleanup — which the `finally` block already does.

#### Acceptance Criteria

- SIGINT during pull → temp directory is cleaned up
- SIGINT during pull → `finally` block executes
- SIGINT during pull → exit code is 130 (128 + SIGINT=2), not 1
- No partial state left in `~/.claude/` after interruption (or at minimum: documented as a known limitation with recovery via `claudefy restore`)

#### Test Cases

- Unit: Verify signal handler sets flag rather than calling process.exit
- Manual: Send SIGINT during a large pull → verify temp dir is cleaned and finally block runs

---

### P0-05: Add `settings.local.json` to HARDCODED_DENYLIST

**Component:** `src/sync-filter/sync-filter.ts`
**Type:** Bug — security gap
**Severity:** High

#### Problem

`settings.local.json` is Claude Code's designated file for personal, non-shared settings. The `.local.` naming convention across the Claude Code ecosystem (also used in `CLAUDE.local.md`, `.claude/settings.local.json` at project level) explicitly means "do not share, do not sync, do not commit to git."

If a user has `settings.local.json` in their `~/.claude/`, it currently falls to the "unknown" tier and gets synced to the remote store. This could leak personal configuration preferences, local tool permissions, or machine-specific overrides to all other machines sharing the repo.

#### Required Changes

This is technically part of P0-02 but called out separately because it requires a code change to `HARDCODED_DENYLIST`, not just a config change:

```ts
// src/sync-filter/sync-filter.ts
const HARDCODED_DENYLIST = [".credentials.json", "settings.local.json"];
```

#### Acceptance Criteria

- `settings.local.json` is denied even if a user adds it to their custom allowlist in `~/.claudefy/sync-filter.json`
- No code path can sync this file

---

## 5. P1 Issues (High Value)

### P1-01: Document or address `~/.claude.json` handling

**Component:** Documentation + potentially new sync logic
**Type:** Feature gap
**Severity:** High

#### Problem

`~/.claude.json` (note: in `$HOME`, NOT inside `~/.claude/`) is a critical part of the Claude Code ecosystem. It contains:

- **MCP server definitions** — user-scope MCP server configurations with commands, args, and sometimes credentials. These are arguably the second most valuable thing to sync across machines after `CLAUDE.md`.
- **Per-project state** — `allowedTools`, `hasTrustDialogAccepted`, `lastSessionId`, `lastCost`, `exampleFiles`. Machine-specific.
- **OAuth session** — `oauthAccount` with `accountUuid`, `emailAddress`, `organizationUuid`. NEVER sync.
- **Feature flags** — `cachedStatsigGates`, `cachedGrowthBookFeatures`. Machine-specific cache.
- **Usage tracking** — `numStartups`, `tipsHistory`, `memoryUsageCount`. Machine-specific.
- **Preferences** — `theme`, `preferredNotifChannel`, `autoUpdates`. Potentially worth syncing.

Claudefy completely ignores this file. Users who configure MCP servers on one machine must manually reconfigure them on every other machine.

#### Options (pick one)

**Option A — Document the gap (minimal effort):**
Add a section to README and docs/architecture.md explaining that `~/.claude.json` is out of scope, why (it mixes syncable preferences with OAuth secrets and machine-specific state), and recommend users manage MCP server configs manually or via a dotfiles approach.

**Option B — Selective sync of `~/.claude.json` (recommended):**
Add a new sync category for `~/.claude.json` that:
1. Reads the file
2. Extracts only the `mcpServers` block (and optionally `theme`, `preferredNotifChannel`)
3. Writes the extracted block to a new store location (e.g., `store/config/claude-json-mcpServers.json`)
4. On pull, deep-merges the synced `mcpServers` into the local `~/.claude.json` without touching other fields
5. NEVER syncs: `oauthAccount`, `projects`, `cachedStatsigGates`, `cachedGrowthBookFeatures`, `numStartups`, `customApiKeyResponses`, or any other field

This is more complex but delivers high user value. The MCP server configs are the exact kind of thing users want portable.

**Option C — New `claudefy sync-mcp` subcommand (middle ground):**
A standalone command that syncs only MCP server definitions, keeping it separate from the main push/pull pipeline. Lower risk, opt-in.

#### Acceptance Criteria (Option B)

- `mcpServers` block from `~/.claude.json` is synced across machines
- OAuth tokens, per-project state, feature flags are NEVER synced
- Deep merge on pull (local MCP servers + remote MCP servers, no deletions)
- Security stripping applied: MCP server configs that reference local filesystem paths should be path-mapped
- Clear documentation of what is and isn't synced from this file

#### Test Cases

- Unit: Extract `mcpServers` from a full `~/.claude.json` fixture
- Unit: Merge two `mcpServers` blocks without data loss
- Unit: Verify OAuth fields are never written to store
- Integration: Push MCP servers from Machine A, pull on Machine B, verify presence

---

### P1-02: Tighten Twilio secret scanner regex — too many false positives

**Component:** `src/secret-scanner/scanner.ts`
**Type:** Bug — false positive
**Severity:** Medium

#### Problem

The current Twilio API key pattern:

```ts
{ name: "Twilio API Key", regex: /SK[0-9a-fA-F]{32}/ }
```

Matches any string starting with `SK` followed by 32 hex characters. This produces false positives on:
- SHA-256 hashes that happen to start with `SK` (probability: ~1/256 per hash)
- Random identifiers, UUIDs, and hex-encoded data
- Git commit SHAs or content hashes in session transcripts
- Base64-encoded data that contains `SK` followed by hex-looking characters

Actual Twilio API key SIDs follow the format `SK` + 32 lowercase hex characters, and they appear in specific contexts (usually as JSON values or environment variables).

#### Required Changes

Option A (conservative): Tighten to lowercase-only and require word boundary:

```ts
{ name: "Twilio API Key", regex: /\bSK[0-9a-f]{32}\b/ }
```

Option B (more precise): Require it appears in a value context:

```ts
{ name: "Twilio API Key", regex: /\bSK[0-9a-f]{32}\b(?!\w)/ }
```

Also consider adding a `Datadog API Key` refinement — the current pattern `dd[a-z]{0,2}_[0-9a-zA-Z]{32,}` could match strings like `dd_` followed by any alphanumeric. Consider tightening to known Datadog prefixes: `ddapi_`, `ddog_`.

#### Test Cases

- Unit: `SK` + 32 lowercase hex chars matches (valid Twilio key)
- Unit: `SK` + 32 uppercase hex chars does NOT match (uppercase = not a Twilio key)
- Unit: A SHA-256 hash starting with `sk` does not trigger if it's part of a longer hex string
- Regression: All existing scanner tests continue to pass

---

### P1-03: Add `claudefy diff` preview command

**Component:** New command `src/commands/diff.ts`
**Type:** Feature — missing
**Severity:** Medium

#### Problem

`claudefy status` shows file classification (allow/deny/unknown) but provides no information about what has actually changed between local and remote. Users have no way to preview what a push or pull would do before executing it. This is a fundamental expectation for any sync tool.

#### Required Behavior

```bash
# Show what push would change
claudefy diff --push

# Show what pull would change
claudefy diff --pull

# Default: show both directions
claudefy diff
```

Output should show:
- Files that would be added (present locally, not in store — or vice versa)
- Files that would be updated (content differs)
- Files that would be removed (present in store, not locally — or vice versa)
- For text files: abbreviated content diff (first N lines of difference)

#### Implementation Notes

- Reuse the existing `collectStoreHashes` method from `PushCommand` for hash comparison
- For pull direction: compare store contents against local `~/.claude/`
- For push direction: run the classification + normalization pipeline in dry-run mode and compare against store
- Do NOT require passphrase (skip decryption — just report "encrypted file changed" for `.age` files)

#### Acceptance Criteria

- `claudefy diff` shows pending changes in both directions
- `claudefy diff --push` shows only push-direction changes
- `claudefy diff --pull` shows only pull-direction changes
- Encrypted files show "changed (encrypted)" without requiring passphrase
- Output is human-readable with clear add/modify/delete indicators
- Exit code 0 if no changes, 1 if changes exist (useful for scripting)

---

### P1-04: Encryption model creates false sense of security — document or change

**Component:** `src/commands/push.ts`, documentation
**Type:** Design flaw
**Severity:** Medium

#### Problem

The current encryption model is "reactive" — when `encryption.enabled` is true, only two categories of files are encrypted:
1. Allowlisted files where the secret scanner detects a pattern match (15 regex patterns)
2. All unknown-tier files (always encrypted)

Allowlisted files that don't trigger the scanner ship to the remote in **plaintext**, even when the user has explicitly enabled encryption. This creates a gap between user expectation ("I enabled encryption, my data is encrypted") and reality ("only files with detected secrets are encrypted; everything else is plaintext").

The 15 regex patterns cannot catch: custom internal API tokens, database connection strings with non-standard formats, bearer tokens in HTTP headers logged in session transcripts, OAuth refresh tokens, SSH private key material in configuration, and any secret format not covered by the scanner.

#### Options

**Option A — Encrypt everything when enabled (recommended):**
When `encryption.enabled` is true, encrypt ALL files in the store, not just those with detected secrets. The secret scanner becomes a guardrail that BLOCKS push when encryption is disabled, rather than the primary encryption trigger.

This changes the encryption model from "reactive" to "all-or-nothing":
- `encryption.enabled: true` → all files encrypted
- `encryption.enabled: false` + secret detected → push blocked with error
- `encryption.enabled: false` + no secrets → push in plaintext

Impact: larger git diffs (encrypted files change entirely when content changes, even with AES-SIV determinism). But users who enable encryption presumably accept this tradeoff.

**Option B — Prominent documentation + opt-in full encryption:**
Keep the current reactive model as default. Add a new config option:

```json
{
  "encryption": {
    "enabled": true,
    "mode": "reactive" | "full"
  }
}
```

`"reactive"` = current behavior (default, backward-compatible)
`"full"` = encrypt everything

Add prominent warnings in README, `claudefy doctor`, and push output explaining what "reactive" means.

**Option C — Documentation only (minimal effort):**
Add explicit warnings everywhere that "encryption.enabled does not mean all files are encrypted" and explain the reactive model. Update `claudefy doctor` to show encryption mode details.

#### Acceptance Criteria (Option B)

- New `encryption.mode` config option with `"reactive"` and `"full"` values
- `"reactive"` is the default (backward-compatible)
- `"full"` encrypts all files regardless of scanner results
- `claudefy doctor` reports the encryption mode
- README updated with clear explanation of both modes

---

### P1-05: Merger array dedup heuristic can silently lose data

**Component:** `src/merger/merger.ts`
**Type:** Bug — silent data loss
**Severity:** Medium

#### Problem

The `Merger.deepMergeJson()` uses a heuristic to deduplicate arrays during settings merge:

```ts
private findArrayKey(arr: unknown[]): string | null {
  // Returns "name", "id", or "key" if all array elements have that property
  // Returns null otherwise
}
```

When `findArrayKey` returns `null` (array elements don't have `name`/`id`/`key`), the array merge strategy defaults to **replacing the local array with the remote array** (`return source`). This means local-only entries are silently dropped.

This affects `settings.json` arrays like:
- `permissions.allow` — array of permission strings like `"Bash(npm run *)"`. These don't have `name`/`id`/`key` properties because they're strings, not objects. A user's local permission rules could be silently overwritten by remote.
- `permissions.deny` — same issue.
- Any string array in settings.

#### Required Changes

When `findArrayKey` returns null:
1. If array elements are primitives (strings, numbers): use Set-based dedup (union of both arrays)
2. If array elements are objects without identifiable keys: append local-only items to the end (conservative merge)

```ts
arrayMerge: (target: unknown[], source: unknown[]) => {
  // Primitive arrays: union
  if (source.length > 0 && typeof source[0] !== "object") {
    const set = new Set([...source.map(String)]);
    const localOnly = target.filter(item => !set.has(String(item)));
    return [...source, ...localOnly];
  }

  // Object arrays with identifiable key: existing logic
  const key = this.findArrayKey(source);
  if (key) { /* existing logic */ }

  // Object arrays without key: append local-only items
  const sourceJson = new Set(source.map(item => JSON.stringify(item)));
  const localOnly = target.filter(item => !sourceJson.has(JSON.stringify(item)));
  return [...source, ...localOnly];
}
```

#### Test Cases

- Unit: Merging `["a", "b"]` (local) + `["b", "c"]` (remote) → `["b", "c", "a"]`
- Unit: Merging `[{name:"x"}]` + `[{name:"y"}]` → existing key-based dedup still works
- Unit: Merging `[{foo:"bar"}]` + `[{baz:"qux"}]` → both items preserved (no key match)
- Regression: All existing merger tests pass

---

### P1-06: Document hooks-strip-hooks UX contradiction

**Component:** Documentation (README, docs/hooks.md)
**Type:** UX — confusing behavior
**Severity:** Low

#### Problem

`claudefy init --hooks` installs SessionStart/SessionEnd hooks into `settings.json`. But on pull, the `hooks` key is stripped from remote `settings.json` for security reasons. This means:

1. User sets up Machine A with `--hooks` ✓
2. User does `claudefy join --hooks` on Machine B ✓ (hooks installed by the `--hooks` flag, not by sync)
3. User does `claudefy join` on Machine C (no `--hooks` flag) ✗ (no hooks, even though Machine A has them)

User expectation: "I set up hooks on Machine A, they should sync to Machine C."
Reality: Hooks are security-sensitive and deliberately NOT synced.

This is the correct behavior, but it's confusing. The README mentions it briefly in docs/hooks.md but it should be much more prominent.

#### Required Changes

1. Add a prominent callout box in README under the "Quick Start" section
2. When `claudefy join` completes WITHOUT `--hooks`, print a hint: "Tip: run 'claudefy hooks install' to enable auto-sync on this machine"
3. When `claudefy pull` detects that hooks exist in the remote settings but were stripped, print an info message (only once, track in config)
4. `claudefy doctor` should check if hooks are installed and suggest installation if not

#### Acceptance Criteria

- `claudefy join` (no --hooks) prints hook installation hint
- `claudefy doctor` warns when hooks are not installed
- README has clear callout explaining why hooks don't sync

---

### P1-07: Add schema validation for `claudefy config set`

**Component:** `src/commands/config.ts`
**Type:** Bug — no input validation
**Severity:** Low

#### Problem

`claudefy config set` accepts any value for any key without validation:

```bash
claudefy config set encryption.enabled "banana"    # Writes string "banana"
claudefy config set version -5                      # Writes -5
claudefy config set backend.type "svn"              # Writes "svn" (not a supported type)
```

The `parseValue` method converts `"true"`/`"false"` to booleans and numeric strings to numbers, but doesn't validate against the actual schema.

#### Required Changes

Add basic schema validation in `ConfigCommand.set()`:

```ts
const SCHEMA: Record<string, { type: string; values?: unknown[] }> = {
  "encryption.enabled": { type: "boolean" },
  "encryption.useKeychain": { type: "boolean" },
  "encryption.cacheDuration": { type: "string" },
  "backend.type": { type: "string", values: ["git"] },
  "backend.url": { type: "string" },
  "version": { type: "number" },
};
```

Reject writes that don't match the expected type. Allow unknown keys with a warning (for forward-compatibility).

#### Test Cases

- Unit: `config set encryption.enabled true` → succeeds
- Unit: `config set encryption.enabled banana` → error
- Unit: `config set backend.type svn` → error
- Unit: `config set custom.key value` → succeeds with warning

---

### P1-08: `history.jsonl` path normalization is incomplete for session transcripts

**Component:** `src/path-mapper/path-mapper.ts`, documentation
**Type:** Limitation — incomplete normalization
**Severity:** Low

#### Problem

`PathMapper.normalizeJsonlLine()` handles `project` and `cwd` fields in JSONL lines. But Claude Code session transcripts (`.jsonl` files inside `projects/`) contain many more path-bearing fields:

- `message.content` in tool_use blocks contains absolute file paths (e.g., `{"type": "tool_use", "name": "Read", "input": {"file_path": "/Users/user/project/src/app.ts"}}`)
- `message.content` in tool_result blocks contains file contents with paths
- `cwd` in user messages
- The `projects/` directory names themselves are path-encoded (`-Users-user-myproject`)

The directory name encoding is handled by `normalizeDirName`/`remapDirName`, which is correct. But the paths inside tool_use/tool_result content are not normalized. On a different machine, these embedded paths reference non-existent locations.

#### Required Changes

**Option A — Document the limitation (recommended for v2):**
Add to docs/architecture.md and docs/path-mapping.md: "Path normalization applies to top-level JSONL fields (`project`, `cwd`) and directory names. Paths embedded within tool_use/tool_result message content are not normalized. These are historical references and do not affect Claude Code functionality on the receiving machine."

**Option B — Deep path normalization (future):**
Walk the `message.content` tree in session transcript lines, identifying tool_use inputs with file path fields, and apply path mapping. This is complex and error-prone — paths appear in many formats and contexts. Recommend deferring.

---

### P1-09: `doctor` command should warn (not fail) for missing git-lfs

**Component:** `src/commands/doctor.ts`
**Type:** Bug — incorrect severity
**Severity:** Low

#### Problem

`doctor` checks for `git-lfs` as a binary dependency and returns `"fail"` if it's not found. However, git-lfs is only needed if session history files are large enough to trigger LFS tracking (configured via `.gitattributes`). Many users will never need LFS, and a "fail" status is alarming.

#### Required Changes

Change the git-lfs check from `"fail"` to `"warn"`:

```ts
// In checkBinary result for git-lfs:
return { name, status: "warn", detail: `${name} not found in PATH — needed for large session files` };
```

#### Test Cases

- Unit: `doctor` returns `"warn"` (not `"fail"`) when git-lfs is missing

---

## 6. P2 Issues (Important Polish)

### P2-01: Add `claudefy uninstall` cleanup command

**Component:** New command `src/commands/uninstall.ts`
**Type:** Feature — missing

#### Description

There is no clean way to remove all traces of claudefy. A user who wants to stop using the tool must manually:
1. Remove hooks from `~/.claude/settings.json`
2. Delete `~/.claudefy/` directory
3. (Optionally) delete the remote git repository

#### Required Behavior

```bash
claudefy uninstall
# Interactive confirmation:
# "This will remove claudefy hooks, config, store, and backups. Continue? (y/N)"
# Steps:
# 1. Remove hooks from settings.json
# 2. Delete ~/.claudefy/ (config, store, backups, lock)
# 3. Print: "Remote repository at <url> was NOT deleted. Remove manually if desired."
```

NEVER delete `~/.claude/` — only claudefy's own data.

---

### P2-02: Add passphrase rotation command

**Component:** New command `src/commands/rotate.ts`
**Type:** Feature — missing

#### Description

If a user's passphrase is compromised, there's no way to re-encrypt everything with a new key. The user would have to `override --confirm` with encryption disabled, then re-init with a new passphrase on every machine.

#### Required Behavior

```bash
claudefy rotate-passphrase
# Prompts for old passphrase, new passphrase, confirmation
# Steps:
# 1. Decrypt all .age files in store with old passphrase
# 2. Re-encrypt with new passphrase
# 3. Update keychain if useKeychain is enabled
# 4. Commit and push
# 5. Print: "Passphrase rotated. Update CLAUDEFY_PASSPHRASE on all machines."
```

---

### P2-03: Add selective sync (`--only` flag)

**Component:** `src/commands/push.ts`, `src/commands/pull.ts`
**Type:** Feature — missing

#### Description

Users cannot push or pull individual files or categories. If a user only changed their slash commands and wants a quick push, they must push everything.

```bash
claudefy push --only commands
claudefy push --only settings.json
claudefy pull --only CLAUDE.md
```

The `--only` flag filters the classification result to only include matching items. The rest of the pipeline runs unchanged.

---

### P2-04: Windows path handling in PathMapper

**Component:** `src/path-mapper/path-mapper.ts`
**Type:** Bug — platform support gap

#### Problem

`pathToDirName()` only handles forward slashes:

```ts
private pathToDirName(localPath: string): string {
  return localPath.replace(/\//g, "-");
}
```

On Windows, Claude Code encodes paths with backslashes (e.g., `C:\Users\user\project` → `-C--Users-user-project` or similar). The current implementation will not match Windows-encoded directory names.

#### Required Changes

```ts
private pathToDirName(localPath: string): string {
  return localPath.replace(/[\\/]/g, "-");
}
```

Also audit `normalizePathField` and `remapPathField` for Windows path separators.

Document that claudefy is tested on Linux/macOS, with best-effort Windows support.

---

### P2-05: `--skip-encryption` should print a warning

**Component:** `src/cli.ts`
**Type:** UX — missing guardrail

#### Problem

`--skip-encryption` is described in the README as "testing only" but is a regular CLI flag with no warning when used. A user could accidentally push sensitive data in plaintext.

#### Required Changes

When `--skip-encryption` is used and `encryption.enabled` is true in config, print a warning:

```
⚠ Encryption is enabled in config but --skip-encryption flag is set.
  Files will be pushed/pulled WITHOUT encryption. Use only for testing.
```

---

### P2-06: Improve update check — don't write cache in quiet mode

**Component:** `src/update-check.ts`
**Type:** Bug — minor

#### Problem

The update check writes `~/.claudefy/update-check.json` regardless of quiet mode. While the check itself is suppressed with `-q`, the cache file write (which includes a network fetch) still runs. This causes unnecessary disk writes and network requests during hook-triggered operations.

#### Required Changes

Skip the entire update check (including cache write) when quiet mode is active. The current code already skips the update check if `!process.stdout.isTTY || isQuiet`, but the import and execution of `checkForUpdates` still happens. Move the guard earlier:

```ts
// src/index.ts
if (process.stdout.isTTY && !isQuiet) {
  // Only then import and run
}
```

This is already the case in the current code — verify it works correctly by checking that the dynamic import doesn't execute when quiet.

---

### P2-07: Add `claudefy export` for portable backup

**Component:** New command
**Type:** Feature — missing

#### Description

`claudefy restore` restores from internal backups, but there's no way to create a portable export (e.g., a tarball) that can be moved to a machine without claudefy set up, or used for disaster recovery when the git remote is unavailable.

```bash
claudefy export --output ~/claude-backup.tar.gz
# Creates a tarball of ~/.claude/ (classified files only, respecting deny list)
```

---

### P2-08: Secret scanner should support custom patterns

**Component:** `src/secret-scanner/scanner.ts`, config
**Type:** Feature — missing

#### Description

The 15 hardcoded patterns cannot cover all secret formats. Users with custom internal tokens (e.g., `MYCOMPANY_TOKEN_xxx`) have no way to add detection rules.

Add support for custom patterns in `~/.claudefy/config.json`:

```json
{
  "secretScanner": {
    "customPatterns": [
      { "name": "Internal Token", "regex": "MYCO_[A-Za-z0-9]{32}" }
    ]
  }
}
```

---

### P2-09: Add `--dry-run` flag to push and pull

**Component:** `src/commands/push.ts`, `src/commands/pull.ts`
**Type:** Feature — missing

#### Description

Closely related to P1-03 (diff command), but as a flag on existing commands:

```bash
claudefy push --dry-run
# Shows what would be pushed without actually doing it

claudefy pull --dry-run
# Shows what would be pulled without actually doing it
```

This is simpler than a full `diff` command and may be preferred for v2 as an MVP.

---

### P2-10: Backup retention policy

**Component:** `src/backup-manager/backup-manager.ts`
**Type:** Feature — missing

#### Description

Backups accumulate in `~/.claudefy/backups/` with no retention policy. Over time, this directory can grow unbounded. Add a config option:

```json
{
  "backups": {
    "maxCount": 10,
    "maxAgeDays": 30
  }
}
```

After creating a new backup, prune old backups that exceed the count or age limit.

---

## 7. P3 Issues (Nice-to-Have)

### P3-01: `output.warn` writes to stderr, `output.info` to stdout — inconsistent for piping

**Component:** `src/output.ts`
**Type:** Minor UX

`warn` and `error` go to stderr; `success`, `info`, `dim`, `heading` go to stdout. This is actually correct Unix convention (warnings/errors to stderr, normal output to stdout), but it means piping `claudefy push 2>/dev/null` hides warnings. Document this behavior.

---

### P3-02: Add `claudefy logs` command for sync history

**Component:** New command
**Type:** Feature — missing

Show recent sync operations (timestamps, direction, file counts, success/failure) by parsing git log from the store.

---

### P3-03: LFS `.gitattributes` is written during init but not join

**Component:** `src/commands/init.ts`, `src/commands/join.ts`
**Type:** Bug — minor inconsistency

`InitCommand` writes `.gitattributes` with LFS tracking rules, but `JoinCommand` doesn't. If Machine A inits with LFS rules and Machine B joins, Machine B gets the `.gitattributes` via git clone (correct), but if Machine B joins an empty store, it won't have the LFS rules.

Fix: Move `.gitattributes` creation to the git adapter's `initStore` method so it's always present.

---

### P3-04: `ConfigManager.set` double-validates forbidden keys

**Component:** `src/config/config-manager.ts`
**Type:** Code quality

The `set` method checks `FORBIDDEN_KEYS.includes(part)` for every segment, but then also checks the same thing inside the loop. The check before the loop (`for (const part of parts)`) makes the check inside the loop redundant. Minor code cleanup.

---

### P3-05: Add CI badge for test coverage

**Component:** `.github/workflows/ci.yml`, `package.json`
**Type:** DevEx

The CI runs lint + format + build + test but doesn't report coverage. Add `vitest --coverage` and a coverage badge to the README.

---

### P3-06: Add shell completion support

**Component:** CLI
**Type:** Feature — DX

Commander.js supports generating shell completions. Add `claudefy completion` that outputs bash/zsh/fish completion scripts.

---

### P3-07: Consider `--force` flag for push when remote is ahead

**Component:** `src/commands/push.ts`
**Type:** Feature — missing

If `pullAndMergeMain()` fails during push (remote has diverged), the push continues with local state only and prints a warning. Consider adding `--force` to explicitly handle this case, or `--pull-first` as the default behavior (pull before push).

---

## 8. Implementation Phases

### Phase 1 — Critical Fixes (P0, target: v2.0)

| Issue | Effort | Dependencies |
|-------|--------|--------------|
| P0-01: Update allowlist | S | None |
| P0-02: Update denylist | S | None |
| P0-05: Hardcoded denylist for settings.local.json | S | None |
| P0-03: Lockfile | M | None |
| P0-04: Signal handler fix | S | None |

Estimated effort: ~2–3 days

### Phase 2 — High Value (P1, target: v2.1)

| Issue | Effort | Dependencies |
|-------|--------|--------------|
| P1-01: ~/.claude.json handling | L | Phase 1 |
| P1-02: Twilio regex fix | S | None |
| P1-03: Diff command | M | None |
| P1-04: Encryption model | M-L | None |
| P1-05: Merger array fix | M | None |
| P1-06: Hooks documentation | S | None |
| P1-07: Config validation | S | None |
| P1-08: Path normalization docs | S | None |
| P1-09: Doctor git-lfs severity | S | None |

Estimated effort: ~5–7 days

### Phase 3 — Polish (P2, target: v2.2)

| Issue | Effort | Dependencies |
|-------|--------|--------------|
| P2-01: Uninstall command | M | None |
| P2-02: Passphrase rotation | M | None |
| P2-03: Selective sync | M | None |
| P2-04: Windows paths | S | None |
| P2-05: Skip-encryption warning | S | None |
| P2-06: Update check quiet mode | S | None |
| P2-07: Export command | M | None |
| P2-08: Custom secret patterns | M | None |
| P2-09: Dry-run flag | M | P1-03 |
| P2-10: Backup retention | S | None |

Estimated effort: ~5–8 days

### Phase 4 — Backlog (P3, ongoing)

Pick as time permits. P3-03 (gitattributes) and P3-04 (config cleanup) are quick wins.

---

## 9. Testing Strategy

### Current State

- 220 tests across 32 test files, all passing
- Good coverage of core modules (encryptor, path-mapper, sync-filter, merger, config, secret-scanner)
- Command tests use filesystem mocks with real temp directories
- Integration tests cover full push/pull cycles

### Gaps to Address

1. **No concurrent operation tests** — Add after P0-03 (lockfile)
2. **No Windows path tests** — Add after P2-04
3. **No test for new allowlist/denylist items** — Add with P0-01/P0-02
4. **No fuzz testing for secret scanner** — Consider for P2-08
5. **No snapshot tests for CLI output** — Low priority but useful for regression

### Recommended New Test Files

| File | Covers |
|------|--------|
| `tests/lockfile/lockfile.test.ts` | P0-03 |
| `tests/commands/diff.test.ts` | P1-03 |
| `tests/commands/uninstall.test.ts` | P2-01 |
| `tests/commands/rotate.test.ts` | P2-02 |
| `tests/merger/array-merge.test.ts` | P1-05 (dedicated edge cases) |

---

## 10. Appendix: ~/.claude vs claudefy Classification Map

Complete classification of every known `~/.claude` item as of March 2026:

| Item | Current Tier | Correct Tier | Change Needed? |
|------|-------------|-------------|----------------|
| `commands/` | allow | allow | No |
| `agents/` | allow | allow | No |
| `skills/` | allow | allow | No |
| `hooks/` | allow | allow | No |
| `rules/` | allow | allow | No |
| `plans/` | allow | allow | No |
| `plugins/` | allow | allow | No |
| `agent-memory/` | allow | allow | No |
| `projects/` | allow | allow | No |
| `settings.json` | allow | allow | No |
| `history.jsonl` | allow | allow | No |
| `package.json` | allow | allow | No |
| **`CLAUDE.md`** | **unknown** | **allow** | **YES — P0-01** |
| **`MEMORY.md`** | **unknown** | **allow** | **YES — P0-01** |
| `cache/` | deny | deny | No |
| `backups/` | deny | deny | No |
| `file-history/` | deny | deny | No |
| `shell-snapshots/` | deny | deny | No |
| `paste-cache/` | deny | deny | No |
| `session-env/` | deny | deny | No |
| `tasks/` | deny | deny | No |
| `.credentials.json` | deny (hardcoded) | deny (hardcoded) | No |
| `mcp-needs-auth-cache.json` | deny | deny | No |
| **`settings.local.json`** | **unknown** | **deny (hardcoded)** | **YES — P0-02/P0-05** |
| **`statsig/`** | **unknown** | **deny** | **YES — P0-02** |
| **`telemetry/`** | **unknown** | **deny** | **YES — P0-02** |
| **`ide/`** | **unknown** | **deny** | **YES — P0-02** |
| **`debug/`** | **unknown** | **deny** | **YES — P0-02** |
| **`todos/`** | **unknown** | **deny** | **YES — P0-02** |
| **`stats-cache.json`** | **unknown** | **deny** | **YES — P0-02** |
