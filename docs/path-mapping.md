# Path Mapping

## The Problem

Claude Code stores absolute paths in several places:

- `settings.json` — project directories, plugin paths, command paths
- `history.jsonl` — `project` and `cwd` fields
- `plugins/*.json` — plugin configuration paths
- `projects/` — subdirectory names derived from local paths

These absolute paths break when syncing between machines with different home directories or project locations.

## The Solution

claudefy uses **bidirectional path normalization** with sentinel tokens:

| Sentinel | Meaning | Used In | Example |
|----------|---------|---------|---------|
| `@@CLAUDE_DIR@@` | The `~/.claude/` directory | settings.json, plugins/*.json | `/home/alice/.claude/` → `@@CLAUDE_DIR@@` |
| `@@alias@@` | A project link | settings.json, history.jsonl | `/home/alice/myapp` → `@@myapp@@` |

The `@@CLAUDE_DIR@@` sentinel replaces the absolute `~/.claude/` path prefix in all string values (recursively). The `@@alias@@` sentinel replaces project-specific paths that match a registered link — this works in both `settings.json` (via recursive value replacement) and `history.jsonl` (via the `project` and `cwd` fields).

### Push (Normalize)

Local absolute paths are replaced with sentinels before committing to the store:

```json
// Before normalization (local settings.json)
{
  "projectDir": "/home/alice/.claude/projects/-home-alice-myapp"
}

// After normalization (in store) — @@CLAUDE_DIR@@ replaces the ~/.claude/ prefix
{
  "projectDir": "@@CLAUDE_DIR@@/projects/-home-alice-myapp"
}
```

For history.jsonl, project paths matching a link are replaced with alias sentinels:

```json
// Before: {"project": "/home/alice/myapp", "cwd": "/home/alice/myapp/src"}
// After:  {"project": "@@myapp@@", "cwd": "@@myapp@@/src"}
```

### Pull (Remap)

Sentinels are replaced with the local machine's actual paths:

```json
// In store
{
  "projectDir": "@@CLAUDE_DIR@@/projects/-home-alice-myapp"
}

// After remapping on Machine B
{
  "projectDir": "/Users/bob/.claude/projects/-home-alice-myapp"
}
```

## Project Links

To enable cross-machine path mapping, each machine registers **links** between local paths and canonical aliases:

```bash
claudefy link myapp /home/alice/projects/myapp
```

This creates a mapping in `~/.claudefy/links.json`:

```json
{
  "myapp": {
    "localPath": "/home/alice/projects/myapp",
    "canonicalId": "github.com--alice--myapp",
    "gitRemote": "git@github.com:alice/myapp.git",
    "detectedAt": "2025-03-11T10:30:00.000Z"
  }
}
```

The file is keyed by alias. `gitRemote` is auto-detected from the project's git remote (or `null` if not a git repo). `detectedAt` records when the link was created.

The `canonicalId` is auto-detected from the git remote (via GitIdentity), so you can use any alias you want — the identity is based on the repository URL.

### On Machine B

```bash
claudefy link myapp /Users/bob/workspace/myapp
```

Now when Machine B pulls, `@@myapp@@` resolves to `/Users/bob/workspace/myapp`.

## Project Directory Names

Claude Code stores project-specific configs in `~/.claude/projects/` using directory names derived from the project's absolute path:

```
/home/alice/myapp → ~/.claude/projects/-home-alice-myapp/
```

During sync, these directory names are translated:

- **Push:** `-home-alice-myapp` stays as-is in the store (the PathMapper knows the link mapping).
- **Pull:** The directory is renamed to match the local machine's path: `-Users-bob-workspace-myapp`.

## What Gets Remapped

| File/Location | Fields Remapped |
|---------------|-----------------|
| `settings.json` | All string values recursively |
| `plugins/*.json` | All string values recursively |
| `history.jsonl` | `project` and `cwd` fields per line |
| `projects/` subdirs | Directory names |

## Managing Links

```bash
# Add a link
claudefy link myapp /path/to/project

# Remove a link
claudefy unlink myapp

# List all links
claudefy links
```

## Without Links

If a path doesn't match any link and isn't under `~/.claude/`, it is left unchanged. This means:

- Paths not covered by links will contain the original machine's absolute path.
- The config will still work on the original machine but may break on others.
- For full portability, create links for all projects you reference in Claude Code settings.

## Known Limitations

### Embedded paths in session transcripts

Path normalization applies to:
- Top-level JSONL fields (`project`, `cwd`) in session transcript lines
- Directory names in `projects/` (e.g., `-Users-user-myproject`)

Paths embedded within `tool_use`/`tool_result` message content inside session transcripts are **not** normalized. These include file paths in `Read`, `Write`, `Edit`, and other tool inputs/outputs. On a different machine, these embedded paths reference the original machine's filesystem locations.

This is intentional — these are historical references and do not affect Claude Code functionality on the receiving machine. Deep path normalization of message content would be complex and error-prone, as paths appear in many formats and contexts within tool results.
