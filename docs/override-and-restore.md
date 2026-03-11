# Override & Restore

## Override

The override command wipes the remote store and replaces it entirely with your local `~/.claude` state. Use it when one machine should become the canonical source of truth.

### Usage

```bash
claudefy override --confirm
```

The `--confirm` flag is **required** — without it, the command refuses to run.

### What Happens (Initiator)

1. **Wipe the store.** All files in the git store (except `.git/`) are deleted.
2. **Write override marker.** A `.override` file is created:
   ```json
   {
     "machine": "laptop-a1b2c3d4",
     "timestamp": "2025-03-11T10:30:00.000Z"
   }
   ```
3. **Force push.** The machine branch and `main` are force-pushed to remote.
4. **Full push.** PushCommand runs to repopulate the store with local state.

### What Happens (Other Machines)

When another machine runs `claudefy pull` (manually or via hook):

1. **Detect the `.override` marker.** Checked on the current branch and via `git show main:.override`.
2. **Create a pre-override backup.** The current `~/.claude` is saved to `~/.claudefy/backups/{timestamp}--pre-override/`.
3. **Reset to main.** The machine branch is hard-reset to match `main`.
4. **Acknowledge.** The `.override` marker is removed and the acknowledgement is committed.
5. **Continue normal pull.** The new content from the overriding machine is applied.

### Safety Properties

- No data is lost — a backup is always created before applying an override.
- The `--confirm` flag prevents accidental use.
- Each machine detects and handles the override independently on next pull.

## Backup System

### When Backups Are Created

| Trigger | Label |
|---------|-------|
| Override detected during pull | `pre-override` |
| Before restoring from a backup | `pre-restore` |

### Backup Location

```
~/.claudefy/backups/
  2025-03-11T10-30-00-000Z--pre-override/
    commands/
    settings.json
    ...
  2025-03-11T11-00-00-000Z--pre-restore/
    ...
```

Each backup is a full recursive copy of `~/.claude` at that point in time.

## Restore

### Interactive Restore

```bash
claudefy restore
```

1. Lists available backups (numbered).
2. Prompts you to select one.
3. Creates a `pre-restore` backup of the current state (safety net).
4. Replaces `~/.claude` with the selected backup.

### Example

```
Available backups:
  1. 2025-03-11T10-30-00-000Z--pre-override
  2. 2025-03-11T09-00-00-000Z--pre-override

Select backup to restore (number): 1

Creating safety backup of current state...
Restoring from: 2025-03-11T10-30-00-000Z--pre-override
Done.
```

### Path Traversal Protection

Backup paths are validated to prevent `../` traversal attacks by ensuring the resolved path stays within `~/.claudefy/backups/`. Any backup name that would escape this directory is rejected.
