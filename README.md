<p align="center">
  <img src="https://img.shields.io/npm/v/@kodrunhq/claudefy?color=blue&label=npm" alt="npm version" />
  <img src="https://img.shields.io/github/actions/workflow/status/kodrunhq/claudefy/ci.yml?branch=main&label=CI" alt="CI" />
  <img src="https://img.shields.io/node/v/@kodrunhq/claudefy" alt="node version" />
  <img src="https://img.shields.io/github/license/kodrunhq/claudefy" alt="license" />
  <img src="https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript&logoColor=white" alt="TypeScript" />
</p>

<h1 align="center">claudefy</h1>

<p align="center">
  <strong>Sync your Claude Code environment across every machine you work on.</strong><br/>
  Git-backed &bull; Encrypted &bull; Automatic
</p>

---

claudefy keeps your `~/.claude` directory — commands, skills, agents, hooks, rules, plans, plugins, settings, and project configs — in sync across all your machines through a private git repository. It encrypts sensitive content with AES-256-SIV, normalizes machine-specific paths, deep-merges settings, and can run fully automatically via Claude Code hooks.

## Why claudefy?

- **One config, every machine.** Stop manually copying files between your laptop, desktop, and servers.
- **Safe by design.** Credentials never leave your machine. Secrets are detected and encrypted before push. Remote hooks are stripped on pull to prevent injection.
- **Set it and forget it.** With auto-sync hooks, `pull` runs when Claude Code starts and `push` runs when it ends. No manual steps.
- **Conflict-free.** Per-machine git branches prevent collisions. Deep merge resolves settings.json at the key level.

## Quick Start

**Install:**

```bash
npm install -g @kodrunhq/claudefy
```

**First machine — initialize:**

```bash
# Point to an existing private repo
claudefy init --backend git@github.com:you/claude-sync.git --hooks

# Or auto-create a GitHub repo
claudefy init --create-repo --hooks
```

**Other machines — join:**

```bash
claudefy join --backend git@github.com:you/claude-sync.git --hooks
```

That's it. With `--hooks`, sync is automatic from now on.

**Manual sync (if you skip hooks):**

```bash
claudefy push     # push local changes
claudefy pull     # pull remote changes
claudefy status   # see what would sync
```

## How It Works

```
                        ┌────────────────┐
                        │  Private Git   │
                        │   Repository   │
                        └──────┬─────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
      ┌───────▼──────┐ ┌──────▼───────┐ ┌──────▼───────┐
      │  Machine A   │ │  Machine B   │ │  Machine C   │
      │ branch: m/A  │ │ branch: m/B  │ │ branch: m/C  │
      └───────┬──────┘ └──────┬───────┘ └──────┬───────┘
              │                │                │
         ~/.claude        ~/.claude        ~/.claude
```

Each machine gets its own git branch (`machines/<id>`). Push merges into `main`; pull merges `main` back into the machine branch. No conflicts, no data loss.

### Push pipeline

```
~/.claude  →  SyncFilter  →  PathMapper  →  SecretScanner  →  Encryptor  →  Git push
             (allow/deny)   (normalize)    (detect secrets)   (AES-SIV)
```

### Pull pipeline

```
Git pull  →  Decrypt  →  PathMapper  →  Merger  →  SecurityFilter  →  ~/.claude
                         (remap)      (deep merge)  (strip hooks)
```

## What Gets Synced

| | Items | Notes |
|---|-------|-------|
| **Synced** | commands, agents, skills, hooks, rules, plans, plugins, agent-memory, projects, settings.json, history.jsonl, package.json | Core config that travels with you |
| **Never synced** | cache, backups, file-history, shell-snapshots, paste-cache, session-env, tasks, .credentials.json | Machine-local or sensitive |
| **Unknown** | Anything else | Synced to separate dir, always encrypted when encryption is enabled |

## Commands

### Core

| Command | Description |
|---------|-------------|
| `claudefy init --backend <url>` | Initialize on the first machine |
| `claudefy join --backend <url>` | Join from another machine |
| `claudefy push` | Push local changes to remote |
| `claudefy pull` | Pull remote changes to local |
| `claudefy override --confirm` | Wipe remote, push local as source of truth |
| `claudefy status` | Show file classification |

### Project Links

| Command | Description |
|---------|-------------|
| `claudefy link <alias> <path>` | Map a local project path to a portable ID |
| `claudefy unlink <alias>` | Remove a mapping |
| `claudefy links` | List all mappings |

### Management

| Command | Description |
|---------|-------------|
| `claudefy hooks install` | Install auto-sync hooks |
| `claudefy hooks remove` | Remove auto-sync hooks |
| `claudefy machines` | List registered machines |
| `claudefy restore` | Restore from a backup |
| `claudefy doctor` | Diagnose sync health |
| `claudefy config get/set` | View or update config |

### Global Options

| Option | Description |
|--------|-------------|
| `-q, --quiet` | Suppress output |
| `--skip-encryption` | Skip encryption (testing only) |
| `--skip-secret-scan` | Skip secret scanning on push |

## Encryption

claudefy uses **AES-256-SIV** deterministic encryption via `@noble/ciphers`.

- **Deterministic** — same plaintext always produces the same ciphertext, so unchanged files produce zero git diff.
- **JSONL files** — encrypted line-by-line, preserving git's ability to diff and merge individual lines.
- **Other files** — encrypted as whole files.
- **Key derivation** — PBKDF2-SHA256 with 600,000 iterations. Salt is derived from the backend URL, so SSH and HTTPS URLs for the same repo produce the same key.
- **Reactive** — only files where the secret scanner detects a match are encrypted. Clean files stay in plaintext for easy inspection.

**Passphrase resolution order:**
1. `CLAUDEFY_PASSPHRASE` environment variable (recommended)
2. OS keychain (if configured)

Interactive prompts only occur during `claudefy init` and `claudefy join` setup.

> See [docs/encryption.md](docs/encryption.md) for the full technical deep-dive.

## Security

- `.credentials.json` is **never** synced (hardcoded deny).
- Remote `hooks`, `mcpServers`, `env`, `permissions`, `allowedTools`, and `apiKeyHelper` keys are **stripped** from settings.json on pull — prevents code injection from the remote.
- Secret scanner checks 15 patterns (API keys, tokens, credentials) before push. Secrets trigger encryption; if encryption is disabled, the push is blocked.
- Symlinks are validated against path traversal.
- Passphrases are never stored in plaintext on disk.

> See [docs/security.md](docs/security.md) for the full security model.

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | System design, module map, data flows |
| [Encryption](docs/encryption.md) | AES-SIV, PBKDF2, line-level encryption |
| [Security](docs/security.md) | Threat model, hook stripping, secret scanning |
| [Hooks & Auto-Sync](docs/hooks.md) | SessionStart/SessionEnd hooks, automatic sync |
| [Override & Restore](docs/override-and-restore.md) | Override flow, backup system, restore |
| [Path Mapping](docs/path-mapping.md) | Cross-machine path normalization |

## Configuration

Config lives at `~/.claudefy/config.json`:

```json
{
  "version": 1,
  "backend": { "type": "git", "url": "git@github.com:you/claude-sync.git" },
  "encryption": { "enabled": true, "useKeychain": false, "cacheDuration": "0" },
  "machineId": "hostname-abc12345"
}
```

## Multi-Machine Workflow

1. **First machine:** `claudefy init --backend <url> --hooks`
2. **Other machines:** `claudefy join --backend <url> --hooks`
3. **Auto-sync:** hooks handle push/pull at session boundaries
4. **Override:** `claudefy override --confirm` when one machine should be the source of truth (other machines auto-detect and create a backup before applying)

## Contributing

```bash
git clone https://github.com/kodrunhq/claudefy.git
cd claudefy
npm install
npm run lint && npm run format:check && npm run build && npm test
```

## License

[MIT](LICENSE)
