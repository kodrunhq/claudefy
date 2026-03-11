# Architecture

## Overview

claudefy is a CLI tool that keeps `~/.claude` in sync across machines using a private git repository as the backend. It is built as a pipeline of composable modules, each with a single responsibility.

## Module Map

```
src/
├── cli.ts                  Commander-based CLI entry point
├── index.ts                Binary entry point
├── commands/
│   ├── init.ts             First-machine setup
│   ├── join.ts             Subsequent-machine setup
│   ├── push.ts             Local → remote sync
│   ├── pull.ts             Remote → local sync
│   ├── override.ts         Wipe remote, push local
│   ├── status.ts           File classification report
│   ├── link.ts             Project path mapping
│   ├── machines.ts         List registered machines
│   ├── hooks.ts            Auto-sync hook management
│   ├── restore.ts          Backup restoration
│   ├── config.ts           Config get/set
│   └── doctor.ts           Health diagnostics
├── config/                 ConfigManager, types, defaults
├── sync-filter/            Allow/deny/unknown classification
├── git-adapter/            Git bare repo operations
├── path-mapper/            Bidirectional path normalization
├── encryptor/              AES-SIV encryption facade
├── secret-scanner/         Pattern-based secret detection
├── machine-registry/       Machine tracking via manifest.json
├── merger/                 Deep JSON merge with array dedup
├── backup-manager/         Snapshot creation and restoration
├── hook-manager/           SessionStart/SessionEnd hooks
├── git-identity/           Git remote detection for links
└── repo-creator/           Auto-create GitHub/GitLab repos
```

## Data Flow

### Push (local → remote)

```
~/.claude
  │
  ├─ SyncFilter.classify()
  │   ├─ allow  → config/      (12 item types)
  │   ├─ deny   → skipped      (9 item types)
  │   └─ unknown → unknown/    (everything else)
  │
  ├─ PathMapper.normalize()
  │   └─ Absolute paths → @@CLAUDE_DIR@@ / @@alias@@ sentinels
  │
  ├─ Incremental hash check
  │   └─ SHA256 comparison — only write changed files
  │
  ├─ SecretScanner.scanFiles()
  │   └─ 15 regex patterns for API keys, tokens, credentials
  │
  ├─ Encryptor (reactive — only files with detected secrets)
  │   ├─ JSONL → LineEncryptor (line-by-line AES-SIV)
  │   └─ Other → FileEncryptor (whole-file AES-SIV)
  │
  └─ GitAdapter.commitAndPush()
      ├─ Commit to machines/{machineId}
      ├─ Merge into main
      └─ Push both branches
```

### Pull (remote → local)

```
GitAdapter.pullAndMergeMain()
  │
  ├─ Fetch origin, reset main to remote
  ├─ Merge main into machines/{machineId}
  │
  ├─ Check for .override marker
  │   └─ If found: backup ~/.claude, reset to main, acknowledge
  │
  ├─ Copy store to temp directory
  │
  ├─ Encryptor.decryptDirectory()
  │   ├─ .jsonl.age → LineEncryptor.decrypt()
  │   └─ other .age → FileEncryptor.decrypt()
  │
  ├─ PathMapper.remap()
  │   └─ @@CLAUDE_DIR@@ / @@alias@@ → local absolute paths
  │
  ├─ Merger.deepMergeJson() for settings.json
  │   ├─ Array dedup by name/id/key
  │   └─ Strip dangerous keys (hooks, mcpServers, env, permissions, allowedTools, apiKeyHelper)
  │
  └─ Copy to ~/.claude
```

## Branch Model

```
main                         ← merged state from all machines
├── machines/laptop-a1b2     ← Machine A's working branch
├── machines/desktop-c3d4    ← Machine B's working branch
└── machines/server-e5f6     ← Machine C's working branch
```

- Each machine works exclusively on its own branch.
- Push: commit to machine branch → merge into main → push both.
- Pull: fetch origin → reset main → merge main into machine branch.
- Merge conflicts on the machine branch are aborted (machine state is preserved).

## Store Layout

Inside `~/.claudefy/store/`:

```
.git/                    Git metadata
config/                  Allowlisted items
  settings.json
  commands/
  plugins/
  projects/
    -project-dir-name/
      settings.json
  history.jsonl          (or history.jsonl.age if encrypted)
unknown/                 Unknown-tier items
manifest.json            Machine registry
.gitattributes           LFS config for .jsonl files
```

## Local Config Layout

Inside `~/.claudefy/`:

```
config.json              Backend URL, encryption settings, machineId
links.json               Project path → canonical ID mappings
sync-filter.json         Custom allow/deny overrides
backups/                 Timestamped ~/.claude snapshots
store/                   Git repository clone
```

## Incremental Sync

Push uses SHA256 hash comparison to avoid writing unchanged files:

1. Hash every file in source and store.
2. Only write files where hashes differ.
3. Delete store entries that no longer exist in source.

This keeps git diffs minimal and push operations fast.

## Dependency Graph

```
CLI (commander)
 └─ Commands
     ├─ ConfigManager
     ├─ GitAdapter (simple-git)
     ├─ SyncFilter
     ├─ PathMapper ← GitIdentity
     ├─ SecretScanner
     ├─ Encryptor
     │   ├─ LineEncryptor (@noble/ciphers, @noble/hashes)
     │   └─ FileEncryptor (@noble/ciphers, @noble/hashes)
     ├─ MachineRegistry
     ├─ Merger (deepmerge)
     ├─ BackupManager
     ├─ HookManager
     └─ RepoCreator (gh / glab CLI)
```
