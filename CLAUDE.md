# Claudefy

## Verification

Before pushing, always run:

```sh
npm run lint && npm run format:check && npm run build && npm run test
```

## Fix formatting

```sh
npm run format
```

## Project structure

- `src/` — source code (TypeScript)
- `tests/` — vitest tests (mirror src/ structure)
- `.github/workflows/` — CI (lint, prettier, typecheck, test on Node 20+22)

## Conventions

- Use vitest for tests
- Prettier for formatting, ESLint for linting
- No AI/LLM attribution in commits, PRs, or code
