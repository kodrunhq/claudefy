# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
# Full verification (run before pushing)
npm run lint && npm run format:check && npm run build && npm run test

# Run a single test file
npx vitest run tests/commands/push.test.ts

# Run tests matching a name
npx vitest run -t "pulls files from remote"

# Fix formatting
npm run format

# Dev mode (run without building)
npx tsx src/index.ts <command>
```

## Architecture

Claudefy is a CLI tool that syncs `~/.claude` config across machines via a git bare repo backend, with optional age encryption and per-machine branching.

### Data flow

**Push:** `~/.claude` -> SyncFilter (allow/deny/unknown) -> PathMapper (normalize paths) -> SecretScanner (detect secrets) -> Encryptor (encrypt sensitive files) -> GitAdapter (commit to machine branch, merge to main, push)

**Pull:** GitAdapter (pull main, merge into machine branch) -> Encryptor (decrypt .age files) -> PathMapper (remap canonical paths to local) -> Merger (deep merge settings.json) -> copy to `~/.claude`

### Key design decisions

- **Per-machine branches:** Each machine gets its own git branch (named `machines/<machineId>`). Changes merge into `main`. Pull merges `main` into the machine branch.
- **Three-tier sync filter:** Files in `~/.claude` are classified as `allow` (always sync), `deny` (never sync), or `unknown` (sync to separate `unknown/` dir in store).
- **Two encryption strategies:** JSONL files use line-level encryption (preserving line structure for git diffs). All other files use whole-file encryption. Both produce `.age` output files.
- **Path normalization:** Absolute paths in settings.json, plugins, and project directory names are converted to canonical form using `@@CLAUDE_DIR@@` and `@@alias@@` sentinels for portability between machines.
- **Override flow:** `override --confirm` wipes the remote store and pushes local as source of truth. Other machines detect the `.override` marker file on next pull, create a backup, and reset.
- **Hooks security:** Remote `hooks`, `mcpServers`, `env`, `permissions`, `allowedTools`, and `apiKeyHelper` keys are stripped from settings.json during pull to prevent code injection.
- **Encryption:** Reactive — only files where the secret scanner detects a match are encrypted. Files without detected secrets are stored in plaintext even when `encryption.enabled` is true. PBKDF2-SHA256 with 600k iterations and per-repo salt derived from the backend URL (normalized to `host/path` form so SSH and HTTPS URLs produce the same key).

### Store layout (inside `~/.claudefy/store/`)

```
config/           # Mirrors ~/.claude (allowlisted items)
  settings.json
  projects/
  plugins/
unknown/          # Items not in allow or deny lists
manifest.json     # Machine registry
.override         # Marker file (only during override flow)
```

### Module responsibilities

- `src/cli.ts` — Commander-based CLI entry point; resolves passphrase from env/keychain before dispatching to commands
- `src/commands/` — Each command is a class with an `execute()` method. `init`/`join` are first-time setup; `push`/`pull` are the core sync operations.
- `src/encryptor/` — `LineEncryptor` (JSONL, deterministic per-line), `FileEncryptor` (binary, AES-SIV), `Encryptor` (facade that picks strategy by file type)
- `src/path-mapper/` — Bidirectional path remapping using project links (`~/.claudefy/links.json`)
- `src/git-adapter/` — Wraps `simple-git` for bare repo operations, machine branching, and merge strategies

## Conventions

- ESM-only (`"type": "module"`), all imports use `.js` extensions
- Tests mirror `src/` structure in `tests/` using vitest
- No AI/LLM attribution in commits, PRs, or code
- CI runs on Node 20 + 22
