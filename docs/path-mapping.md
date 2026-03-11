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

| Sentinel | Meaning | Example |
|----------|---------|---------|
| `@@CLAUDE_DIR@@` | The `~/.claude/` directory | `/home/alice/.claude/` → `@@CLAUDE_DIR@@` |
| `@@alias@@` | A project link | `/home/alice/myapp` → `@@myapp@@` |

### Push (Normalize)

Local absolute paths are replaced with sentinels before committing to the store:

```json
// Before normalization (local)
{
  "projectDir": "/home/alice/.claude/projects/-home-alice-myapp"
}

// After normalization (in store)
{
  "projectDir": "@@CLAUDE_DIR@@projects/@@myapp@@"
}
```

### Pull (Remap)

Sentinels are replaced with the local machine's actual paths:

```json
// In store
{
  "projectDir": "@@CLAUDE_DIR@@projects/@@myapp@@"
}

// After remapping on Machine B
{
  "projectDir": "/Users/bob/.claude/projects/-Users-bob-workspace-myapp"
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
  "links": [
    {
      "alias": "myapp",
      "localPath": "/home/alice/projects/myapp",
      "canonicalId": "github.com--alice--myapp"
    }
  ]
}
```

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
