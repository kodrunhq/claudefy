# claudefy — Product Requirements Document

> **Unify your Claude Code environment across every machine.**

| Field | Value |
|---|---|
| Author | José (Jurel89) |
| Organization | kodrunhq |
| Repo | `github.com/kodrunhq/claudefy` |
| Distribution | `npm: claudefy` / `npx claudefy` |
| License | MIT (proposed) |
| Runtime | Node.js 18+ (cross-platform CLI) |
| Status | Planning / Pre-development |
| Version | v0.1 — March 2026 — DRAFT |

---

## 1. Problem Statement

Claude Code stores all configuration, session history, memory, plugins, and project state under `~/.claude`, tightly coupled to the local filesystem. Sessions are indexed by **absolute path**. This creates three critical pain points for anyone working across multiple machines:

- **No portability.** Commands, agents, skills, hooks, and plugins configured on Machine A do not exist on Machine B. Users manually copy files or start from scratch.
- **Broken session resume.** Claude Code indexes sessions by absolute filesystem path. A project at `/home/jose/projects/kodrun` on Linux and `C:\Users\jose\dev\kodrun` on Windows are treated as completely separate projects. `claude --resume` fails across machines even with identical codebases.
- **No conflict awareness.** Existing sync tools (rsync, Syncthing, cloud storage) work at the file level. They cannot handle semantic conflicts in memory, settings merges, or path normalization.

> **Market Gap:** Existing tools (claude-brain, Claude Sync, chezmoi) each solve one piece. None handles cross-OS path remapping, per-component conflict strategy, and selective sync in a single tool. claudefy fills this gap.

---

## 2. Target Users

| Persona | Environment | Key Pain Point |
|---|---|---|
| Solo dev (power user) | Multiple Linux machines, homelab, NAS | Config drift between machines, manual sync |
| Corporate developer | Windows laptop (work) + Mac (home) | No admin rights, different OS, no shared network |
| Freelancer | MacBook + desktop + VPS | Moderate skill, needs it to just work |
| Small team (3–5) | Mixed OS, shared skills/agents | Want shared conventions, personal sessions |

---

## 3. Core Features

### 3.1 Project Identity Layer (Path Remapping)

The single most important differentiator. claudefy introduces a **canonical project identity** that decouples session data from filesystem paths.

- **Project IDs derived from:** git remote URL (preferred), a `.claudefy-id` file in the project root, or a user-defined alias.
- **`claudefy link <alias> <local-path>`** maps a local directory to a canonical project ID.
- **On push:** absolute paths in session data are normalized to canonical IDs.
- **On pull:** canonical IDs are remapped back to the local machine's actual paths.

Example workflow:

```bash
# Machine A (Linux workstation)
claudefy link kodrun ~/projects/kodrun

# Machine B (Windows/WSL)
claudefy link kodrun /mnt/c/Users/jose/dev/kodrun

# Machine C (Mac)
claudefy link kodrun ~/dev/kodrun

# All three now share sessions, memory, and state for "kodrun"
```

### 3.2 Selective Sync with Component Tiers

Not all Claude Code assets are equal. claudefy classifies them into three tiers with different sync strategies:

| Tier | Assets | Sync Strategy | Default |
|---|---|---|---|
| **Tier 1: Static Config** | `commands/`, `agents/`, `skills/`, `hooks/`, plugins list, `settings.json`, `CLAUDE.md` | File-level sync, last-write-wins with backup | ON |
| **Tier 2: Semantic State** | Auto-memory, GSD `.planning/` state | Append-only log + periodic dedup (`claudefy compact`) | ON |
| **Tier 3: Sessions** | `~/.claude/projects/` (session history) | Opt-in, requires path remapping via `link` | OFF |

Users override defaults per-tier: `claudefy config set sync.sessions true`

### 3.3 Backend Flexibility

claudefy is storage-agnostic. Users bring their own backend:

| Backend | Setup | Best For |
|---|---|---|
| **Git repo** (private) | `claudefy init --backend git@github.com:user/store.git` | 90% of users. Free, encrypted with age. Works everywhere. |
| **S3 / R2 / GCS** | `claudefy init --backend s3://bucket/claudefy` | Teams, larger state, binary session files. |
| **Local / NFS / Syncthing** | `claudefy init --backend local:/mnt/nas/claude` | Homelab users with shared storage. claudefy still handles path remapping. |

### 3.4 Encryption

All synced data is encrypted before leaving the machine using **age** (by Filippo Valsorda):

- **Passphrase-derived keys:** same passphrase on any machine generates the same key. No key distribution needed.
- **Selective encryption:** only sensitive files (settings with API keys, memory) are encrypted. Commands and skills remain readable in the repo for easy review.
- **SOPS compatibility:** optional integration with Mozilla SOPS for users who already use it.

### 3.5 Per-Component Conflict Resolution

Different asset types need different merge strategies:

| Component | Strategy | Rationale |
|---|---|---|
| `commands/`, `agents/`, `skills/` | Last-write-wins + `.bak` backup | Authored files, rarely edited simultaneously |
| `settings.json` | Deep JSON merge (key-level) | Machine A adds hook, Machine B changes permission — both survive |
| `CLAUDE.md` | Section-aware merge | Append new sections, flag conflicts in shared sections |
| Memory | Append-only + dedup on `compact` | No overwrites; `compact` removes duplicates |
| Sessions | Per-project isolation | Different projects never conflict; same project uses LWW |
| Plugin list | Union merge | If Machine A has Superpowers and Machine B has GSD, both propagate |

### 3.6 Claude Code Hook Integration

Optional auto-sync via Claude Code's native hook system:

- `claudefy hooks install` — writes `SessionStart` (pull) and `SessionEnd` (push) hooks to `~/.claude/settings.json`
- `claudefy hooks remove` — cleanly removes hooks
- Manual sync always available: `claudefy push` / `claudefy pull` / `claudefy status`

> **Design Principle:** Hooks are optional, not required. The tool must work perfectly with manual push/pull for users who prefer explicit control or whose environments don't support hooks.

### 3.7 Force Override (Nuclear Option)

When a user reaches a desired state of assets on one machine and wants to make it the canonical source of truth — wiping whatever mess accumulated on the remote:

- **`claudefy override`** — wipes the remote store completely and pushes the current machine's full `~/.claude` state as the new baseline.
- **Mandatory double confirmation:** this is a destructive operation. Two explicit confirmations required:

```
$ claudefy override

⚠️  DESTRUCTIVE OPERATION
This will DELETE all data in the remote store and replace it
with this machine's current ~/.claude state.

All other machines will receive this state on next pull.
Any unsynced changes on other machines will be lost.

Remote: git@github.com:kodrunhq/claudefy-state.git
Machine: nuc-i7 (Linux)
Assets: 14 commands, 6 agents, 12 skills, 3 project sessions

Type "override" to confirm: override
Are you absolutely sure? [y/N]: y

✓ Remote store wiped
✓ Pushed full state from nuc-i7
✓ All machines will sync to this baseline on next pull
```

- On the next `pull` from any other machine, claudefy detects the override and shows a warning before applying:

```
$ claudefy pull

⚠️  Remote was overridden by nuc-i7 at 2026-03-09T14:32:00Z
Your local state will be replaced. Backup saved to ~/.claudefy/backups/

Apply? [y/N]: y
✓ Pulled override baseline. Local state updated.
```

- The pre-override state on the pulling machine is always backed up to `~/.claudefy/backups/<timestamp>/` so nothing is truly unrecoverable.

---

## 4. CLI Interface

### 4.1 Core Commands

| Command | Description |
|---|---|
| `claudefy init --backend <url>` | Initialize store on first machine. Creates remote structure. |
| `claudefy join <url>` | Join existing store from a second machine. Pulls config, registers machine. |
| `claudefy push` | Encrypt and push local `~/.claude` state to remote store. |
| `claudefy pull` | Pull remote store, decrypt, remap paths, write to local `~/.claude`. |
| `claudefy sync` | Pull then push (bidirectional). Smart conflict resolution per component. |
| `claudefy status` | Show what's diverged between local and remote. No changes made. |
| `claudefy override` | Wipe remote and push this machine as source of truth. Double confirmation required. |
| `claudefy link <alias> <path>` | Map a local project directory to a canonical project ID. |
| `claudefy unlink <alias>` | Remove a project mapping. |
| `claudefy links` | List all project mappings on this machine. |
| `claudefy compact` | Deduplicate memory entries and clean up stale session data. |
| `claudefy config set <key> <val>` | Set configuration (e.g., `sync.sessions true`). |
| `claudefy config get [key]` | Show current config or specific key. |
| `claudefy hooks install` | Install SessionStart/SessionEnd auto-sync hooks into Claude Code. |
| `claudefy hooks remove` | Remove auto-sync hooks. |
| `claudefy machines` | List all registered machines, last sync time, OS, hostname. |
| `claudefy export` | Export full `~/.claude` state as encrypted portable archive. |
| `claudefy import <archive>` | Import from archive, with path remapping. |
| `claudefy doctor` | Diagnose sync issues, check backend connectivity, validate state. |

### 4.2 Example Session

```bash
# First machine (Linux workstation)
$ claudefy init --backend git@github.com:kodrunhq/claudefy-state.git
✓ Initialized claudefy store

$ claudefy link kodrun ~/projects/kodrun
✓ Linked kodrun → ~/projects/kodrun (auto-detected: github.com/kodrunhq/kodrun)

$ claudefy push
✓ Pushed: 12 commands, 4 agents, 8 skills, 2 sessions, settings.json, CLAUDE.md

# Second machine (Mac)
$ claudefy join git@github.com:kodrunhq/claudefy-state.git
✓ Pulled: 12 commands, 4 agents, 8 skills, settings.json, CLAUDE.md

$ claudefy link kodrun ~/dev/kodrun
✓ Linked kodrun → ~/dev/kodrun (matched existing project ID)
✓ Remapped 2 sessions from canonical ID to local path

# Weeks later — machine A has the perfect setup
$ claudefy override
⚠️  DESTRUCTIVE OPERATION ...
Type "override" to confirm: override
Are you absolutely sure? [y/N]: y
✓ Remote store wiped. Pushed full state from nuc-i7.
```

---

## 5. Architecture

### 5.1 High-Level Flow

```
Local ~/.claude
     ↓
claudefy push (normalize paths → encrypt → upload)
     ↓
Remote Store (git repo / S3 bucket / NFS share)
     ↓
claudefy pull (download → decrypt → remap paths)
     ↓
Remote machine ~/.claude
```

claudefy never modifies Claude Code's internal behavior — it only reads and writes files that Claude Code already uses.

### 5.2 Internal Modules

| Module | Responsibility |
|---|---|
| `path-mapper` | Normalizes absolute paths to canonical project IDs and back. Maintains per-machine link registry. |
| `store-adapter` | Abstracts backend (git, S3, local). Each adapter implements push/pull/status/wipe. |
| `encryptor` | age-based encryption/decryption. Handles selective encryption by file pattern. |
| `merger` | Per-component conflict resolution. JSON deep merge, append-only logs, LWW. |
| `hook-manager` | Installs/removes Claude Code hooks. Generates hook scripts that call claudefy push/pull. |
| `machine-registry` | Tracks registered machines (hostname, OS, last sync timestamp, path mappings). |
| `config-manager` | Reads/writes claudefy's own config (`~/.claudefy/config.json`). Separate from Claude Code's config. |
| `backup-manager` | Creates timestamped backups before destructive operations (override, pull after override). |

### 5.3 Remote Store Structure

```
claudefy-store/
├── manifest.json              # machine registry, project ID mappings, sync metadata
├── config/                    # shared ~/.claude config
│   ├── commands/
│   ├── agents/
│   ├── skills/
│   ├── hooks.json
│   ├── settings.json
│   ├── CLAUDE.md
│   └── plugins.json           # installed plugin list (not cache binaries)
├── projects/
│   ├── kodrun/                # canonical project ID
│   │   ├── sessions/          # path-normalized session data
│   │   ├── memory/
│   │   └── planning/          # GSD state if applicable
│   └── spark-lens/
├── .override                  # present if last push was an override (machine, timestamp)
└── .sync-state/
    ├── nuc-i7.json            # per-machine last-sync timestamps
    ├── macbook.json
    └── conflict.log
```

### 5.4 Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Runtime | Node.js 18+ | Matches Claude Code ecosystem. Enables `npx` distribution. |
| CLI framework | Commander.js or yargs | Lightweight, well-known. |
| Encryption | age (via rage-wasm or child_process) | Modern, audited, passphrase-derived keys. |
| Git operations | isomorphic-git or simple-git | Pure JS git for portability. No git binary dependency. |
| S3 operations | `@aws-sdk/client-s3` (optional peer dep) | Only loaded if S3 backend selected. |
| JSON merging | deepmerge + custom strategies | Per-component merge logic. |
| Testing | Vitest | Fast, modern, good ESM support. |

---

## 6. Competitive Landscape

| Feature | claude-brain | Claude Sync | chezmoi+age | **claudefy** |
|---|---|---|---|---|
| Path remapping | No | No | No | **Yes** ✔ |
| Cross-OS | Partial | Yes | Yes | **Yes** ✔ |
| Selective sync | No | No | Yes | **Yes** ✔ |
| Zero infrastructure | Git | Cloud bucket | Git | **Git / S3 / Local** ✔ |
| Conflict handling | LLM merge | Overwrite | File-level | **Per-component** ✔ |
| Session sync | No | Yes (broken) | No | **Opt-in + remap** ✔ |
| Hook integration | Yes | No | No | **Optional** ✔ |
| Plugin sync | No | File copy | No | **Union merge** ✔ |
| Memory handling | LLM dedup | Overwrite | N/A | **Append + compact** ✔ |
| Force override | No | No | No | **Yes (double confirm)** ✔ |

> **Key Differentiator:** claudefy is the only tool that solves cross-OS path remapping for Claude Code sessions. This single feature unlocks session portability — the #1 requested feature in the Claude Code community (GitHub issue #25739).

---

## 7. Milestones

### v0.1 — Foundation (MVP)

**Goal:** Working sync for a solo dev across two machines with a git backend.

- `init` / `join` / `push` / `pull` / `status` commands
- Git backend adapter
- Tier 1 sync (commands, agents, skills, hooks, settings, CLAUDE.md)
- age encryption with passphrase
- `link` / `unlink` / `links` for project identity
- Basic path remapping (push normalizes, pull remaps)
- Machine registry (hostname, OS, last sync)
- `doctor` command for diagnostics

### v0.2 — Conflict Intelligence

**Goal:** Reliable multi-machine sync without data loss.

- Per-component conflict resolution (JSON merge, append-only memory, LWW)
- `sync` command (bidirectional)
- Tier 2 sync (memory with append + `compact`)
- `compact` command for memory deduplication
- Backup creation before destructive merges
- `config` command for user preferences

### v0.3 — Sessions, Hooks & Override

**Goal:** Full session portability, hands-free sync, and reset capability.

- Tier 3 sync (sessions, opt-in)
- Full path remapping in session JSONL files
- `hooks install` / `hooks remove` for auto-sync
- **`override` command with double confirmation**
- Override detection on pull (warning + backup)
- GSD `.planning/` state sync (project-scoped)
- Plugin list union merge

### v1.0 — Multi-Backend & Teams

**Goal:** Production-ready for diverse environments and small teams.

- S3/R2/GCS backend adapter
- Local/NFS backend adapter (with path remap support)
- `export` / `import` for portable archives
- Team mode: shared config layer + personal overrides
- SOPS integration (optional)
- CI/CD mode for automated environments

---

## 8. Strategic Positioning

### 8.1 Relationship to Kodrun

claudefy is an independent tool under the kodrunhq organization. It complements Kodrun but does not depend on it:

- **Kodrun = runtime.** Manages parallel autonomous coding sessions. Docker sandboxes, test gates, cost analytics.
- **claudefy = portability.** Ensures your Claude Code environment is consistent across all machines where Kodrun or Claude Code runs.
- **Claudernettes = control plane UI.** Web dashboard for managing Claude Code sessions across SSH-connected remote machines (future product).

Together, the three tools form a complete stack: claudefy syncs your environment, Kodrun runs your agents, Claudernettes gives you visibility.

### 8.2 Growth Strategy

- **Open source (MIT):** maximize adoption. The Claude Code plugin ecosystem is exploding — interoperability is key.
- **npm distribution:** `npx claudefy` is the install command. Zero friction.
- **Claude Code plugin:** distribute as a plugin with `/claudefy:status`, `/claudefy:push`, `/claudefy:pull` slash commands.
- **Community:** list on awesome-claude-code, buildwithclaude.com, Anthropic marketplace.
- **Content:** launch blog post showing Windows + Mac sync use case. Target the GitHub issue #25739 audience directly.

### 8.3 Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Anthropic builds native sync | High — obsoletes core value prop | Move fast, establish user base. Native sync unlikely to support S3/NFS/teams. |
| Claude Code changes `~/.claude` structure | Medium — breaks parsing | Version-aware adapters. Pin to known structures, detect changes via `doctor`. |
| Trademark concerns ("claude" in name) | Low — for OSS | Standard in ecosystem (claudish, claudex, ClaudeSync). Rebrand if commercial. |
| Session JSONL format is undocumented | Medium — path remap fragility | Reverse-engineer, test extensively, fallback to skip unrecognized fields. |
| Users corrupt state with concurrent writes | Medium | Lockfile per-machine. `doctor` detects corruption. Backup on every push. |

---

## 9. Success Metrics

| Metric | 3-month target | 6-month target |
|---|---|---|
| GitHub stars | 500 | 2,000 |
| npm weekly downloads | 200 | 1,000 |
| Registered machines (telemetry opt-in) | 100 | 500 |
| Open issues resolved | >80% | >80% |
| Cross-OS sync success rate | >95% | >99% |

---

## 10. Open Questions

- **Session JSONL path format:** Need to reverse-engineer exactly how Claude Code stores absolute paths in session files. Are they in the filename, inside the JSONL, or both?
- **Memory dedup without LLM:** claude-brain uses Claude API for semantic dedup ($0.50–2/mo). Can we achieve 90% accuracy with simpler heuristics (exact match + fuzzy string distance)?
- **Plugin cache sync:** Should claudefy sync the full plugin cache (`~/.claude/plugins/cache/`) or just a manifest of installed plugins and let each machine reinstall?
- **Windows native support:** Claude Code on Windows requires WSL. Should claudefy also require WSL, or work natively on Windows (PowerShell/cmd) for config-only sync?
- **Claude Code plugin format:** Should v1 ship as both an npm CLI and a Claude Code plugin? Or CLI-first with plugin later?
- **Override propagation:** Should `override` set a TTL after which the override flag is cleared, or should it persist until every registered machine has pulled?

---

*End of document.*