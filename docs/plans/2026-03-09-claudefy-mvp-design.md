# claudefy MVP Design

> Sync your entire Claude Code environment across machines, including sessions.

| Field | Value |
|---|---|
| Date | 2026-03-09 |
| Status | Approved (brainstorming session) |
| Scope | MVP — solo dev, cross-OS, git backend |

---

## 1. Design Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Primary user | Cross-OS developer (Linux + Mac/Windows) |
| What to sync | Everything in `~/.claude` — sessions, config, plugins, history, agent-memory |
| Session resume | Critical — the killer feature. `claude --resume` must work across machines. |
| Project identity | Auto-detect from git remote, manual `link` override for edge cases |
| Backend | Git repo only for MVP |
| Encryption | Selective — age with passphrase-derived keys |
| Conflict resolution | Deep JSON merge for `settings.json`, LWW + backup for everything else |
| Auto-sync | Hooks on SessionStart/SessionEnd + manual push/pull |
| Override | Yes, with double confirmation |
| Path remapping depth | Directory names + known fields (history.jsonl project field). Full content remapping deferred. |
| Init/join flow | Separate commands. `init` can auto-create GitHub/GitLab repos. |
| Unknown directories | Sync encrypted (always). Denylist for known junk. Allowlist for known safe. |
| Secret scanning | Pre-push scan of plaintext files using `detect-secrets-js` |
| Passphrase UX | Env var > OS keychain > interactive prompt. Hooks fail gracefully if unavailable. |

---

## 2. CLI Commands

### Entry Points

```
claudefy init --backend <git-url>              # First machine. Uses existing remote repo.
claudefy init --backend <git-url> --create-repo # Auto-creates GitHub/GitLab repo.
claudefy init                                   # Interactive — prompts for provider, repo name, visibility.
claudefy join <git-url>                         # Subsequent machines. Clones and pulls state.
```

### Daily Commands

```
claudefy push       # Normalize paths -> filter -> scan secrets -> encrypt -> commit -> git push
claudefy pull       # git pull -> decrypt -> remap paths -> merge -> write to ~/.claude
claudefy status     # Show diff between local and remote (no changes made)
claudefy override   # Wipe remote, push local as truth (type "override" + y/N confirmation)
```

### Project Identity

```
claudefy link <alias> [path]   # Map local path to canonical project ID (auto-detects git remote)
claudefy unlink <alias>        # Remove mapping
claudefy links                 # List all mappings on this machine
```

### Configuration & Maintenance

```
claudefy config set <key> <val>   # e.g., encryption.use-keychain true
claudefy config get [key]
claudefy machines                 # List registered machines, last sync time, OS
claudefy doctor                   # Diagnose issues (git, git-lfs, encryption, connectivity)
claudefy hooks install            # Auto-sync on SessionStart/SessionEnd
claudefy hooks remove
```

### Dangerous Commands Safety

All destructive operations require explicit confirmation:

- **`override`** — type "override" + y/N confirmation
- **`pull` after override** — shows warning, prompts y/N, creates backup first

---

## 3. Architecture

### Data Flow

```
LOCAL ~/.claude
      |
      v
+---------------+     +---------------+     +------------------+
| Sync Filter   |---->| Path Mapper   |---->| Secret Scanner   |
| (allow/deny/  |     | (normalize    |     | (detect-secrets) |
|  unknown)     |     |  abs->canon)  |     |                  |
+---------------+     +---------------+     +------------------+
                                                    |
                                                    v
                                            +---------------+
                                            | Encryptor     |
                                            | (age, select- |
                                            |  ive)         |
                                            +---------------+
                                                    |
                                                    v
                                            +---------------+
                                            | Git Adapter   |
                                            | (commit, push,|
                                            |  LFS)         |
                                            +-------+-------+
                                                    |
                                                    v
                                              REMOTE REPO

PULL is the reverse: Git Adapter -> Decrypt -> Remap Paths -> Merge -> Write ~/.claude
```

### Internal Modules

| Module | Responsibility |
|---|---|
| **sync-filter** | Classifies every file/dir in `~/.claude` into allowlist, denylist, or unknown. Reads from config. |
| **path-mapper** | On push: replaces absolute paths with canonical project IDs. On pull: remaps back. Maintains per-machine link registry. |
| **secret-scanner** | Pre-push scan of plaintext files using `detect-secrets-js`. Warns user, offers to encrypt or skip. |
| **encryptor** | age encryption with passphrase-derived keys. Allowlisted files follow user preference. Unknown files always encrypted. |
| **git-adapter** | Clone, commit, push, pull, force-push. Detects LFS-eligible files by size threshold. Uses `simple-git`. |
| **merger** | On pull: deep JSON merge for `settings.json`, LWW for everything else. Detects override flag. |
| **hook-manager** | Installs/removes Claude Code hooks in `settings.json`. Generates hook entries calling `claudefy push/pull --quiet`. |
| **machine-registry** | Tracks hostname, OS, last sync timestamp per machine. Stored in `manifest.json` in remote repo. |
| **backup-manager** | Creates `~/.claudefy/backups/<timestamp>/` before destructive operations. |
| **repo-creator** | Creates GitHub/GitLab repos via `gh`/`glab` CLI during `init --create-repo`. |

---

## 4. Sync Filter — Three-Tier Model

### Default Classification

**Allowlist (sync, encryption per user config):**

- `commands/`, `agents/`, `skills/`, `hooks/`, `rules/`, `plans/`
- `plugins/` (full cache + manifests)
- `agent-memory/`
- `projects/` (sessions — needs path remapping)
- `settings.json`, `history.jsonl`, `package.json`

**Denylist (never sync):**

- `cache/`, `backups/`, `file-history/`, `shell-snapshots/`
- `paste-cache/`, `session-env/`, `tasks/`
- `.credentials.json`, `mcp-needs-auth-cache.json`

**Unknown (sync, always encrypted):**

- Everything else (e.g., `get-shit-done/`, `gsd-file-manifest.json`)
- New plugin directories that appear in `~/.claude` in the future

### User Overrides

```bash
claudefy config set filter.get-shit-done allow    # move to allowlist
claudefy config set filter.get-shit-done deny      # stop syncing
```

### First Push Behavior

On first push, if unknown items are detected, claudefy lists them and informs the user they will be synced encrypted. Proceeds with Y/n confirmation. After first push, unknown items sync silently.

---

## 5. Path Remapping

### Project Identity Resolution

`claudefy link kodrun ~/dev/kodrun` resolves to:

```json
{
  "kodrun": {
    "localPath": "/home/joseibanez/develop/projects/kodrun",
    "canonicalId": "github.com--kodrunhq--kodrun",
    "gitRemote": "git@github.com:kodrunhq/kodrun.git",
    "detectedAt": "2026-03-09T14:00:00Z"
  }
}
```

If the directory isn't a git repo, the alias itself becomes the canonical ID.

### What Gets Remapped (MVP)

**Directory names in `projects/`:**

```
push: -home-joseibanez-develop-projects-kodrun  ->  github.com--kodrunhq--kodrun
pull: github.com--kodrunhq--kodrun  ->  -mnt-c-Users-jose-dev-kodrun
```

**Known fields in `history.jsonl`:**

```
push: {"project": "/home/joseibanez/develop/projects/kodrun"} -> {"project": "@@kodrun@@"}
pull: {"project": "@@kodrun@@"} -> {"project": "/mnt/c/Users/jose/dev/kodrun"}
```

The `@@alias@@` sentinel prevents accidental collisions with real content.

### What Doesn't Get Remapped (MVP)

Absolute paths inside session JSONL content (tool calls, file reads). These are contextual and remapping could corrupt data. Deferred to post-MVP as opt-in.

### Unlinked Projects on Pull

If a remote project has no local link, claudefy prompts: link now or skip sessions for this project.

---

## 6. Encryption

### Passphrase Resolution Chain

1. **`CLAUDEFY_PASSPHRASE` env var** — set in shell profile, always available for hooks
2. **OS keychain** — gnome-keyring / macOS Keychain / Windows Credential Manager (via `keytar`)
3. **Interactive prompt** — fallback

During `init`, user chooses storage method. Hooks use env var or keychain. If neither available, hooks skip with a warning (no hang, no crash).

### Encryption Rules

| Category | Encrypted? |
|---|---|
| Allowlist files (commands, agents, skills, hooks, rules, plugins, agent-memory) | Default no (user configurable) |
| `settings.json`, `history.jsonl` | Default yes |
| Files flagged by secret scanner | Forced yes |
| Unknown tier | Always yes |
| Denylist | Never synced |

---

## 7. Conflict Resolution

### Merge Strategies

| Component | Strategy | On conflict |
|---|---|---|
| `settings.json` | Deep JSON merge (key-level) | Same key changed on both sides: LWW by timestamp |
| Everything else | Last-write-wins (file modification time) | Overwritten file backed up to `~/.claudefy/backups/` |

### Override Flow

`claudefy override` writes `.override` marker to remote. Next `pull` from any machine detects it, warns, backs up local state, then applies.

---

## 8. Remote Store Structure

```
claudefy-store/
+-- manifest.json                         # machine registry, sync metadata
+-- config/
|   +-- commands/                         # plaintext
|   +-- agents/                           # plaintext
|   +-- skills/                           # plaintext
|   +-- hooks/                            # plaintext
|   +-- rules/                            # plaintext
|   +-- plans/                            # plaintext
|   +-- plugins/                          # plaintext (full cache + manifests)
|   +-- agent-memory/                     # plaintext
|   +-- settings.json.age                 # encrypted
|   +-- history.jsonl.age                 # encrypted (paths normalized)
|   +-- package.json                      # plaintext
+-- projects/
|   +-- github.com--kodrunhq--kodrun/     # canonical project ID
|   |   +-- <session-files>.age           # encrypted, path-normalized
|   +-- github.com--kodrunhq--claudefy/
+-- unknown/                              # always encrypted
|   +-- get-shit-done.tar.age
|   +-- gsd-file-manifest.json.age
+-- .override                             # present after override (machine, timestamp)
+-- .gitattributes                        # LFS tracking rules
+-- .sync-state/
    +-- nuc-i7.json
    +-- macbook-pro.json
```

**LFS rules:** `projects/**/*.jsonl.age` tracked via git-lfs.

---

## 9. Local State

```
~/.claudefy/
+-- config.json          # backend URL, encryption settings, sync preferences
+-- machine-id           # unique ID for this machine
+-- links.json           # project alias -> local path mappings
+-- sync-filter.json     # per-directory allow/deny/unknown overrides
+-- backups/
    +-- <timestamp>/     # pre-destructive-operation backups
```

---

## 10. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 18+ | Matches Claude Code ecosystem. `npx claudefy` distribution. |
| Language | TypeScript | Type safety, matches ecosystem. |
| CLI framework | Commander.js | Lightweight, mature, good subcommand support. |
| Git operations | `simple-git` | Wraps native git, supports LFS. |
| Git LFS | Native git-lfs | Prerequisite. `doctor` checks for it. |
| Encryption | `age-encryption` (rage-wasm) | Pure JS, no native binary needed. |
| Secret scanning | `detect-secrets-js` | Yelp's proven patterns, JS/WASM, community-maintained. |
| JSON merging | `deepmerge` | Proven library for settings.json merge. |
| Keychain | `keytar` | Cross-platform OS keychain access. |
| Repo creation | `gh` / `glab` CLI | Already installed for most devs. `doctor` checks. |
| Testing | Vitest | Fast, ESM-native. |

---

## 11. Deferred to Post-MVP

- S3/R2/GCS backend adapter
- Local/NFS backend adapter
- Full text path remapping inside session JSONL content (opt-in)
- `sync` command (bidirectional push+pull)
- `compact` command (memory deduplication)
- `export` / `import` portable archives
- Team mode (shared config + personal overrides)
- SOPS integration
- Claude Code plugin distribution (slash commands)
- Section-aware CLAUDE.md merge
- Plugin list union merge (separate from full cache sync)
