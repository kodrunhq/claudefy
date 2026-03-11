# Security Model

## Threat Model

claudefy syncs configuration through a remote git repository. The security model assumes:

- **The remote is semi-trusted.** It stores your config but should not be able to inject code into your machine.
- **The network may be observed.** Sensitive content must be encrypted before it leaves the local machine.
- **Other machines sharing the repo may be compromised.** A compromised machine should not be able to escalate through synced config.

## Defense Layers

### 1. Credential Isolation

`.credentials.json` is in a **hardcoded deny list** enforced in code and is never synced under any circumstances. Even if a user modifies `~/.claudefy/sync-filter.json` to add it to the allowlist, the hardcoded check takes precedence.

### 2. Hook Stripping (Anti-Injection)

When pulling `settings.json` from remote, these keys are **deleted before merge**:

- `hooks` — prevents remote from installing arbitrary commands
- `mcpServers` — prevents remote from connecting to arbitrary MCP servers
- `env` — prevents remote from injecting environment variables
- `permissions` — prevents remote from altering permission settings
- `allowedTools` — prevents remote from changing tool access
- `apiKeyHelper` — prevents remote from injecting API key helpers

This means a compromised machine pushing malicious hooks will have those hooks stripped when other machines pull.

### 3. Secret Scanner

Before each push, changed files are scanned for 15 secret patterns (only files that differ from the store are checked, not the entire store):

| Pattern | Example |
|---------|---------|
| Anthropic API Key | `sk-ant-...` |
| OpenAI API Key | `sk-...` |
| AWS Access Key | `AKIA...` |
| GitHub Token | `ghp_...` |
| GitHub OAuth | `gho_...` |
| GitLab Token | `glpat-...` |
| Google API Key | `AIza...` |
| Slack Bot Token | `xoxb-...` |
| Slack User Token | `xoxp-...` |
| Stripe Live/Test Key | `sk_live_...` / `sk_test_...` |
| Azure Connection String | `AccountKey=...` |
| Twilio API Key | `SK...` |
| Datadog API Key | `dd..._...` |
| Generic secrets | `"secret": "..."`, `"password": "..."`, etc. |

**Behavior:**
- If secrets are found and encryption is **enabled**: files are encrypted before push.
- If secrets are found and encryption is **disabled**: push is **blocked** with an error.
- Detection includes a redacted snippet (first 4 + last 4 characters) in the output.

### 4. Reactive Encryption

Encryption is applied in two ways:

- **Allowlisted files** with detected secrets are encrypted before push. Clean allowlisted files remain in plaintext for easy inspection and git diffing.
- **Unknown-tier files** are always encrypted when encryption is enabled, regardless of scanner results.
- The scanner is not exhaustive — it catches common patterns. For sensitive repos, keep encryption enabled as a safety net.

### 5. Symlink Validation

During pull, symlinks are validated:

- **Top-level symlinks** in the store are skipped with a warning.
- **Nested symlinks** are prevented by the copy strategy.
- **Path traversal** is checked: resolved paths must stay within `~/.claude/`.

### 6. Passphrase Handling

- Passphrases are **never stored in plaintext** on disk.
- OS keychain integration uses `@napi-rs/keyring` for secure storage.
- Recommended: use `CLAUDEFY_PASSPHRASE` environment variable.

### 7. Config Injection Prevention

`config set` blocks keys containing `__proto__`, `prototype`, or `constructor` to prevent prototype pollution.

### 8. Backup Before Destructive Operations

Automatic backups are created before:

- Applying an override from another machine.
- Restoring from a previous backup.

Backups are stored in `~/.claudefy/backups/` with timestamps and labels.

## Recommendations

1. **Keep encryption enabled.** The secret scanner is a safety net, not a guarantee.
2. **Use `CLAUDEFY_PASSPHRASE` env var** for non-interactive passphrase resolution.
3. **Use a strong passphrase.** PBKDF2 with 600k iterations provides good protection, but a weak passphrase is still a weak passphrase.
4. **Use a private repository.** Even with encryption, metadata (file names, directory structure, timestamps) is visible.
5. **Review unknown-tier files** periodically via `claudefy status` to ensure nothing unexpected is being synced.
