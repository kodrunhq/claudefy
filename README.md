# claudefy

Sync your Claude Code environment across machines.

## What It Does

claudefy syncs your `~/.claude` directory (commands, skills, agents, hooks, rules, plans, plugins, settings, and project configs) across multiple machines using a private git repository as the backend. It handles:

- **Selective sync** — three-tier filter (allow/deny/unknown) controls what syncs
- **Encryption** — sensitive and unknown files encrypted with AES-256-SIV before push
- **Path remapping** — machine-specific paths normalized to canonical IDs
- **Deep merge** — settings.json merged at the key level; other files use last-write-wins
- **Override** — wipe remote and push local as source of truth when needed

## Architecture

claudefy uses a private git repository as the sync backend, with per-machine branches to avoid conflicts.

**Branch model:**
- Each machine syncs to its own branch: `machines/<machineId>`
- `main` holds the merged state from all machines

**Push (SessionEnd):**
Commits local `~/.claude` changes to the machine branch, merges into `main`, and pushes both.

**Pull (SessionStart):**
Fetches `main`, merges into the machine branch, decrypts, remaps paths, and applies to `~/.claude`.

**Override:**
Wipes `main` and force-updates it to match your machine's current state. Useful when one machine should become the canonical source of truth.

## What Gets Synced

| Category | Items | Notes |
|----------|-------|-------|
| **Synced** | commands, agents, skills, hooks, rules, plans, plugins, agent-memory, projects, settings.json, history.jsonl, package.json | Core config that should travel with you |
| **Never synced** | cache, backups, file-history, shell-snapshots, paste-cache, session-env, tasks, .credentials.json | Machine-local or sensitive data |
| **Unknown** | Anything not in either list | Encrypted by default before commit |

## Install

```bash
npm install -g @kodrunhq/claudefy
```

## Quick Start

**First machine (initialize):**

```bash
# Create a private repo (requires gh or glab CLI)
claudefy init --backend git@github.com:you/claude-sync.git

# Or auto-create a GitHub repo
claudefy init --create-repo
```

**Second machine (join):**

```bash
claudefy join --backend git@github.com:you/claude-sync.git
```

**Daily use:**

```bash
claudefy push     # Push local changes to remote
claudefy pull     # Pull remote changes to local
claudefy status   # Show sync status
```

## Commands

### Core Sync

| Command | Description |
|---------|-------------|
| `claudefy init --backend <url>` | Initialize store on first machine |
| `claudefy join --backend <url>` | Join store from another machine |
| `claudefy push` | Push local state to remote |
| `claudefy pull` | Pull remote state to local |
| `claudefy override --confirm` | Wipe remote, push local as source of truth |
| `claudefy status` | Show file classification and sync state |

### Project Mapping

| Command | Description |
|---------|-------------|
| `claudefy link <alias> <path>` | Map a local project path to a canonical ID |
| `claudefy unlink <alias>` | Remove a project mapping |
| `claudefy links` | List all project mappings |

### Configuration

| Command | Description |
|---------|-------------|
| `claudefy config get [key]` | Show config or a specific key |
| `claudefy config set <key> <value>` | Update a config value |
| `claudefy doctor` | Diagnose sync health |
| `claudefy machines` | List registered machines |

### Hooks

| Command | Description |
|---------|-------------|
| `claudefy hooks install` | Install auto-sync hooks (push on SessionEnd, pull on SessionStart) |
| `claudefy hooks remove` | Remove auto-sync hooks |

### Options

Pass `--hooks` to `init` or `join` to install auto-sync hooks automatically.

## Global Options

| Option | Description |
|--------|-------------|
| `-q, --quiet` | Suppress output |
| `--skip-encryption` | Skip encryption (for testing) |
| `--passphrase <passphrase>` | Encryption passphrase (prefer `CLAUDEFY_PASSPHRASE` env var) |

## Encryption

claudefy encrypts files using AES-256-SIV deterministic encryption via `@noble/ciphers`.

**Why deterministic?** Same plaintext always produces the same ciphertext. This means unchanged files produce no git diff, and git's merge machinery can work with encrypted content.

**How different file types are handled:**
- **Session transcripts (.jsonl):** encrypted per-line, so git can diff and merge individual lines
- **Other files:** encrypted as a whole file; deterministic output avoids spurious diffs
- **Size overhead:** ~38% from base64 encoding

**Passphrase resolution order:**
1. `--passphrase` CLI flag (highest priority; avoid — visible in process list)
2. `CLAUDEFY_PASSPHRASE` environment variable
3. OS keychain (requires `keytar`: `npm install -g keytar`)

**What gets encrypted:**
- Files in the "unknown" tier (not in allowlist or denylist) are always encrypted
- Allowlisted files can optionally be encrypted via config

## How It Works

1. **Sync filter** classifies each entry in `~/.claude` as allow, deny, or unknown
2. **Push**: copies allowed files to git store, encrypts unknowns, normalizes paths, commits and pushes
3. **Pull**: fetches from remote, decrypts, remaps paths to local machine, merges (deep merge for JSON, LWW for others)
4. **Path remapping**: project directories use canonical IDs derived from git remotes (e.g., `github.com--owner--repo`)

## Configuration

Config lives at `~/.claudefy/config.json`:

```json
{
  "version": 1,
  "backend": { "type": "git", "url": "git@github.com:you/claude-sync.git" },
  "encryption": { "enabled": true, "useKeychain": false, "cacheDuration": "0" },
  "sync": { "lfsThreshold": 524288 },
  "filter": {},
  "machineId": "hostname-abc12345"
}
```

Modify via `claudefy config set`:

```bash
claudefy config set encryption.enabled false
claudefy config set encryption.useKeychain true
```

## Security Model

- `.credentials.json` is never synced (hardcoded in the deny list)
- All hooks from remote are stripped on pull to prevent code injection
- Secret scanner detects common patterns (API keys, tokens, high-entropy strings) before push — not exhaustive, but catches the obvious ones
- Files with detected secrets are encrypted before commit rather than blocking the push
- Passphrases never stored in plain text on disk
- Unknown files always encrypted — never pushed in cleartext
- `--passphrase` CLI flag warns about process list exposure

## Multi-Machine Workflow

1. **First machine:** `claudefy init --backend <url> --hooks` — creates the store and installs auto-sync hooks
2. **Other machines:** `claudefy join --backend <url> --hooks` — clones the store, registers the machine, pulls config, installs hooks
3. **Automatic sync:** with hooks installed, `pull` runs on SessionStart and `push` runs on SessionEnd — no manual steps needed
4. **Canonical override:** if one machine has the "right" config, run `claudefy override --confirm` to wipe main and push that machine's state as the source of truth

## License

MIT
