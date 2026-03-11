# Hooks & Auto-Sync

## Overview

claudefy can install hooks into Claude Code's settings so that sync happens automatically at session boundaries — no manual `push` or `pull` needed.

## How It Works

Claude Code supports lifecycle hooks in `~/.claude/settings.json`. claudefy installs two:

| Hook | Trigger | Command |
|------|---------|---------|
| **SessionStart** | Claude Code session begins | `claudefy pull --quiet` |
| **SessionEnd** | Claude Code session ends | `claudefy push --quiet` |

The `--quiet` flag suppresses output so hooks run silently.

## Installing Hooks

**During setup:**

```bash
claudefy init --backend <url> --hooks
claudefy join --backend <url> --hooks
```

**After setup:**

```bash
claudefy hooks install
```

## Removing Hooks

```bash
claudefy hooks remove
```

## Checking Hook Status

```bash
claudefy hooks status
```

Returns whether both SessionStart and SessionEnd hooks are installed.

## What Gets Written to settings.json

The hooks are stored under the `hooks` key:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "claudefy pull --quiet"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "claudefy push --quiet"
          }
        ]
      }
    ]
  }
}
```

## Security Note

When pulling settings.json from remote, claudefy **strips the `hooks` key** before merging. This means:

- Hooks are always controlled by your local machine.
- A compromised remote cannot inject hook commands into your settings.
- If you install hooks on Machine A, Machine B won't get those hooks through sync — you need to install them independently on each machine.

This is intentional. Hooks execute arbitrary shell commands, so they must be explicitly installed per machine.

## Workflow

```
Machine A                          Remote                          Machine B
    │                                │                                │
    ├── Session starts ──────────────┤                                │
    │   claudefy pull --quiet        │                                │
    │   (pulls latest from remote)   │                                │
    │                                │                                │
    │   ... work happens ...         │                                │
    │                                │                                │
    ├── Session ends ────────────────┤                                │
    │   claudefy push --quiet        │                                │
    │   (pushes changes to remote)   │                                │
    │                                │                                │
    │                                │   Session starts ──────────────┤
    │                                │   claudefy pull --quiet        │
    │                                │   (gets Machine A's changes)   │
    │                                │                                │
    │                                │   ... work happens ...         │
    │                                │                                │
    │                                │   Session ends ────────────────┤
    │                                │   claudefy push --quiet        │
    │                                │   (pushes Machine B's changes) │
```

## Passphrase Handling with Hooks

Since hooks run non-interactively, you need the passphrase available without a prompt:

1. **Environment variable** (recommended): Set `CLAUDEFY_PASSPHRASE` in your shell profile.
2. **OS keychain**: Enable with `claudefy config set encryption.useKeychain true` and store the passphrase during `init` or `join`.

If neither is available and encryption is enabled, the hook will fail. The `--quiet` flag suppresses normal output, but errors are still printed to stderr. Run `claudefy pull` manually to see the full error details.
