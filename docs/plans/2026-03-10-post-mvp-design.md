# Post-MVP Design: Polish, CI/CD, Feature Completion & First Publish

**Date:** 2026-03-10
**Status:** Approved
**Scope:** 4 PRs completing the project for public release

---

## Context

All 17 phases of the MVP implementation plan are complete. The CLI is fully functional with 90 passing tests. This design covers the remaining work to make claudefy production-ready for public distribution.

## PR Structure

PRs 1-3 are independent and can be implemented in parallel. PR 4 depends on all three.

---

## PR 1: README Documentation

Comprehensive README.md covering:

- **Project tagline** — "Sync your Claude Code environment across machines"
- **Quick start** — install via npm, `init` on first machine, `join` on second
- **All commands** with usage examples:
  - `init`, `join`, `push`, `pull`, `override`, `status`
  - `link`, `unlink`, `links`
  - `machines`
  - `hooks install`, `hooks remove`
  - `config get`, `config set` (new in PR 3)
  - `doctor` (new in PR 3)
- **Global options** — `--quiet`, `--skip-encryption`, `--passphrase`
- **Encryption** — passphrase resolution chain (env var → keychain → prompt)
- **How it works** — git store, three-tier sync filter, path remapping, merge strategies
- **Configuration** — where config lives (`~/.claudefy/config.json`), configurable options
- **Security** — what's encrypted, secret scanning, passphrase best practices

No badges initially. Badges added after CI is set up.

---

## PR 2: CI/CD Pipeline + Linting

### Linting Setup

**ESLint + Prettier** for code quality and formatting:

- `eslint.config.js` with `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser`
- `.prettierrc` matching current code style (double quotes, trailing commas, 2-space indent, no semicolons or with — match existing convention)
- Scripts in package.json: `lint`, `lint:fix`, `format`, `format:check`
- Dev dependencies: `eslint`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `prettier`

### GitHub Actions Workflows

Three workflow files:

#### `.github/workflows/ci.yml` — Continuous Integration
- **Trigger:** push to `main` + PRs against `main`
- **Concurrency:** cancel in-progress runs for same ref
- **Lint & Typecheck job:** `npx eslint src/ tests/`, `npx prettier --check src/ tests/`, `npx tsc --noEmit`
- **Test job:** matrix on Node 18, 20, 22 — runs `npx vitest run`
- **Build job:** after lint+test pass, runs `npm run build`, uploads `dist/` artifact

#### `.github/workflows/release.yml` — Manual Release (workflow_dispatch)
- **Manual trigger** with version bump choice: patch, minor, major, or auto-detect from conventional commits
- Uses `semantic-release` or `npm version` + git tag
- Bumps version in package.json, creates git tag, pushes, creates GitHub Release
- Requires `GH_TOKEN` secret

#### `.github/workflows/publish.yml` — Publish to npm
- **Trigger:** on GitHub release published (fired by release.yml)
- Builds package
- Smoke test: install from tarball, verify `claudefy --version` works
- Publishes to npm using `NPM_TOKEN` secret

---

## PR 3: Feature Completion

### `config` command

- `claudefy config get [key]` — print full config JSON or a specific key value
- `claudefy config set <key> <value>` — update a config value
- Reads/writes `~/.claudefy/config.json` via existing ConfigManager
- Supports dot-notation keys for nested values (e.g., `encryption.enabled`)
- Files: `src/commands/config.ts`, `tests/commands/config.test.ts`, update `src/cli.ts`

### `doctor` command

- `claudefy doctor` — diagnose sync health
- Checks:
  - git installed
  - git-lfs installed
  - store initialized (config exists)
  - remote reachable (git ls-remote)
  - encryption configured
  - passphrase accessible
  - last sync timestamp
- Outputs checklist with pass/fail/warn per check using chalk output helpers
- Files: `src/commands/doctor.ts`, `tests/commands/doctor.test.ts`, update `src/cli.ts`

### RepoCreator integration into `init`

- Add `--create-repo` flag to `init` command
- When set, calls `RepoCreator.create()` before `gitAdapter.initStore()` to auto-create a private remote repo
- Uses the returned URL as the backend (so `--backend` becomes optional when `--create-repo` is used)
- Files: modify `src/commands/init.ts`, modify `src/cli.ts`, add integration test

### Keytar as optional peer dependency

- Add `keytar` to `peerDependencies` with `"optional": true` in `peerDependenciesMeta`
- Document in README how to enable keychain storage
- The existing conditional import in `passphrase.ts` already handles the fallback gracefully
- Files: modify `package.json`

---

## PR 4: First Publish

- **Version bump** to `1.0.0`
- **LICENSE file** — MIT license
- **Final package.json cleanup** — verify all metadata fields
- **Smoke test** — `npm pack`, install from tarball, verify `claudefy --version` and `claudefy --help`
- **Tag and release** via the manual release workflow

---

## Testing Strategy

- All new commands get unit tests (config, doctor)
- RepoCreator integration gets an integration test with mocked CLI
- Existing 90 tests must continue passing
- CI pipeline validates on Node 18/20/22
- Smoke test validates the built package works end-to-end

## Dependencies

```
PR 1 (README) ──────────┐
PR 2 (CI/CD + Linting) ──┼──→ PR 4 (First Publish)
PR 3 (Features) ─────────┘
```
