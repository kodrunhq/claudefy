# Hardening v1.1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 10 hardening improvements from code review feedback — encryption AD binding, incremental staging, expanded secrets scanner, smart array merge, recursive JSON walk, pull safety, restore command, and cleanup.

**Architecture:** Single branch (`fix/encrypt-secrets-on-scan`), one atomic commit per item. Each task is independent except incremental staging (#3) which depends on the AD binding (#1) being in place. Commit order: trivial cleanups first, then module-level changes, then the big push rewrite, then new features.

**Tech Stack:** TypeScript, vitest, Node.js >=20 built-ins (crypto, fetch, readline), @noble/ciphers (AES-SIV), deepmerge, simple-git, commander

**Spec:** `docs/superpowers/specs/2026-03-11-hardening-v1.1-design.md`

---

## Chunk 1: Cleanups and Encryption

### Task 1: Static Import Cleanup in pull.ts (Design #8)

**Files:**
- Modify: `src/commands/pull.ts:1-12` (imports), `pull.ts:73-86` (override handling), `pull.ts:290` (checkOverrideOnMain)

- [ ] **Step 1: Add static import and remove dynamic imports**

Add `import { simpleGit } from "simple-git";` to the imports. Then replace the 3 dynamic import sites:

```typescript
// pull.ts line 1 — add to imports section:
import { simpleGit } from "simple-git";

// pull.ts lines 73-74 — replace:
//   const { simpleGit: sg } = await import("simple-git");
//   const git = sg(storePath);
// with:
const git = simpleGit(storePath);

// pull.ts lines 80-81 — replace:
//   const { simpleGit: sgCommit } = await import("simple-git");
//   const gitCommit = sgCommit(storePath);
// with:
const gitCommit = simpleGit(storePath);

// pull.ts line 290 — replace:
//   const { simpleGit } = await import("simple-git");
//   const git = simpleGit(storePath);
// with:
const git = simpleGit(storePath);
```

- [ ] **Step 2: Run tests to verify nothing broke**

Run: `npx vitest run tests/commands/pull.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/commands/pull.ts
git commit -m "refactor: replace dynamic simple-git imports with static import in pull.ts"
```

---

### Task 2: Delete Dead `lastWriteWins` (Design #2)

**Files:**
- Modify: `src/merger/merger.ts:11-17` (remove method)
- Modify: `tests/merger/merger.test.ts:45-69` (remove tests)

- [ ] **Step 1: Remove the method from merger.ts**

Delete the `lastWriteWins` method (lines 11-17).

```typescript
// merger.ts becomes:
import deepmerge from "deepmerge";

export class Merger {
  deepMergeJson(local: Record<string, any>, remote: Record<string, any>): Record<string, any> {
    return deepmerge(local, remote, {
      arrayMerge: (_target, source) => source,
    });
  }
}
```

- [ ] **Step 2: Remove the LWW tests from merger.test.ts**

Delete the entire `describe("last-write-wins", ...)` block (lines 45-69).

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/merger/merger.test.ts`
Expected: All remaining tests pass

- [ ] **Step 4: Commit**

```bash
git add src/merger/merger.ts tests/merger/merger.test.ts
git commit -m "refactor: remove unused lastWriteWins method from Merger"
```

---

### Task 3: AD Binding for AES-SIV (Design #1)

**Files:**
- Modify: `src/encryptor/file-encryptor.ts` (add `ad` param to encrypt/decrypt/encryptString/decryptString)
- Modify: `src/encryptor/line-encryptor.ts` (add `ad` param to all methods)
- Modify: `src/encryptor/encryptor.ts` (thread `ad` through facade, compute relative paths in directory methods)
- Modify: `src/commands/push.ts:177-183` (pass AD to encryptor)
- Modify: `src/commands/pull.ts:112-118` (pass AD to encryptor)
- Modify: `tests/encryptor/file-encryptor.test.ts` (update all calls)
- Modify: `tests/encryptor/line-encryptor.test.ts` (update all calls)
- Modify: `tests/encryptor/encryptor.test.ts` (update all calls)

- [ ] **Step 1: Write failing test — different AD produces different ciphertext**

Add to `tests/encryptor/file-encryptor.test.ts`:

```typescript
it("produces different ciphertext for different associated data", () => {
  const encryptor = new FileEncryptor(passphrase);
  const data = new TextEncoder().encode("same content");

  const encrypted1 = encryptor.encrypt(data, "config/file-a.json");
  const encrypted2 = encryptor.encrypt(data, "config/file-b.json");

  expect(encrypted1).not.toBe(encrypted2);
});

it("fails to decrypt with wrong associated data", () => {
  const encryptor = new FileEncryptor(passphrase);
  const data = new TextEncoder().encode("secret");

  const encrypted = encryptor.encrypt(data, "config/real-path.json");

  expect(() => encryptor.decrypt(encrypted, "config/swapped-path.json")).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/encryptor/file-encryptor.test.ts -t "different associated data"`
Expected: FAIL — `encrypt` doesn't accept 2nd argument yet

- [ ] **Step 3: Update FileEncryptor to accept `ad` parameter**

```typescript
// file-encryptor.ts
import { aessiv } from "@noble/ciphers/aes.js";
import { deriveFileKey } from "./key-derivation.js";

export class FileEncryptor {
  private key: Uint8Array;

  constructor(passphrase: string) {
    this.key = deriveFileKey(passphrase);
  }

  encrypt(data: Uint8Array, ad: string): string {
    const adBytes = new TextEncoder().encode(ad);
    const cipher = aessiv(this.key, adBytes);
    const encrypted = cipher.encrypt(data);
    return Buffer.from(encrypted).toString("base64");
  }

  decrypt(encoded: string, ad: string): Uint8Array {
    const adBytes = new TextEncoder().encode(ad);
    const cipher = aessiv(this.key, adBytes);
    const encrypted = new Uint8Array(Buffer.from(encoded, "base64"));
    return cipher.decrypt(encrypted);
  }

  encryptString(text: string, ad: string): string {
    if (text === "") return "";
    return this.encrypt(new TextEncoder().encode(text), ad);
  }

  decryptString(encoded: string, ad: string): string {
    if (encoded === "") return "";
    const decrypted = this.decrypt(encoded, ad);
    return new TextDecoder().decode(decrypted);
  }
}
```

- [ ] **Step 4: Update all existing FileEncryptor tests to pass `ad` argument**

Every existing test call like `encryptor.encrypt(data)` becomes `encryptor.encrypt(data, "test-file")`. Every `encryptString(text)` becomes `encryptString(text, "test-file")`. Same for decrypt calls. Use `"test-file"` as a consistent test AD value.

- [ ] **Step 5: Run FileEncryptor tests**

Run: `npx vitest run tests/encryptor/file-encryptor.test.ts`
Expected: All tests pass including new AD tests

- [ ] **Step 6: Write failing test — LineEncryptor AD binding**

Add to `tests/encryptor/line-encryptor.test.ts`:

```typescript
it("produces different ciphertext for different associated data", () => {
  const enc = new LineEncryptor(passphrase);
  const encrypted1 = enc.encryptLine("same line", "file-a.jsonl");
  const encrypted2 = enc.encryptLine("same line", "file-b.jsonl");
  expect(encrypted1).not.toBe(encrypted2);
});

it("fails to decrypt with wrong associated data", () => {
  const enc = new LineEncryptor(passphrase);
  const encrypted = enc.encryptLine("secret", "real-path.jsonl");
  expect(() => enc.decryptLine(encrypted, "wrong-path.jsonl")).toThrow();
});
```

- [ ] **Step 7: Update LineEncryptor to accept `ad` parameter**

```typescript
// line-encryptor.ts
import { aessiv } from "@noble/ciphers/aes.js";
import { deriveLineKey } from "./key-derivation.js";

export class LineEncryptor {
  private key: Uint8Array;

  constructor(passphrase: string) {
    this.key = deriveLineKey(passphrase);
  }

  encryptLine(line: string, ad: string): string {
    const adBytes = new TextEncoder().encode(ad);
    const cipher = aessiv(this.key, adBytes);
    const plaintext = new TextEncoder().encode(line);
    const encrypted = cipher.encrypt(plaintext);
    return Buffer.from(encrypted).toString("base64");
  }

  decryptLine(encoded: string, ad: string): string {
    const adBytes = new TextEncoder().encode(ad);
    const cipher = aessiv(this.key, adBytes);
    const encrypted = new Uint8Array(Buffer.from(encoded, "base64"));
    const decrypted = cipher.decrypt(encrypted);
    return new TextDecoder().decode(decrypted);
  }

  encryptLines(lines: string[], ad: string): string[] {
    return lines.map((line) => this.encryptLine(line, ad));
  }

  decryptLines(encrypted: string[], ad: string): string[] {
    return encrypted.map((line) => this.decryptLine(line, ad));
  }

  encryptFileContent(content: string, ad: string): string {
    if (content === "") return "";
    const lines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
    const encrypted = this.encryptLines(lines, ad);
    return encrypted.join("\n") + "\n";
  }

  decryptFileContent(content: string, ad: string): string {
    if (content === "" || content.trim() === "") return "";
    const lines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
    const decrypted = this.decryptLines(lines, ad);
    return decrypted.join("\n") + "\n";
  }
}
```

- [ ] **Step 8: Update all existing LineEncryptor tests to pass `ad` argument**

Every call gets `"test-file"` as the AD argument. For example:
- `enc.encryptLine(original)` → `enc.encryptLine(original, "test-file")`
- `enc.decryptLine(encrypted)` → `enc.decryptLine(encrypted, "test-file")`
- Same for `encryptLines`, `decryptLines`, `encryptFileContent`, `decryptFileContent`

- [ ] **Step 9: Run LineEncryptor tests**

Run: `npx vitest run tests/encryptor/line-encryptor.test.ts`
Expected: All tests pass

- [ ] **Step 10: Update Encryptor facade to thread AD**

The `Encryptor` facade needs `ad` on `encryptFile`, `decryptFile`, `encryptString`, `decryptString`. The directory methods compute relative paths from their root:

```typescript
// encryptor.ts
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { LineEncryptor } from "./line-encryptor.js";
import { FileEncryptor } from "./file-encryptor.js";

export class Encryptor {
  private lineEncryptor: LineEncryptor;
  private fileEncryptor: FileEncryptor;

  constructor(passphrase: string) {
    this.lineEncryptor = new LineEncryptor(passphrase);
    this.fileEncryptor = new FileEncryptor(passphrase);
  }

  private isJsonlFile(filePath: string): boolean {
    return filePath.endsWith(".jsonl");
  }

  private isOriginallyJsonl(agePath: string): boolean {
    return agePath.endsWith(".jsonl.age");
  }

  async encryptFile(inputPath: string, outputPath: string, ad: string): Promise<void> {
    if (this.isJsonlFile(inputPath)) {
      const content = await readFile(inputPath, "utf-8");
      const encrypted = this.lineEncryptor.encryptFileContent(content, ad);
      await writeFile(outputPath, encrypted);
    } else {
      const data = await readFile(inputPath);
      const encrypted = this.fileEncryptor.encrypt(new Uint8Array(data), ad);
      await writeFile(outputPath, encrypted);
    }
  }

  async decryptFile(inputPath: string, outputPath: string, ad: string): Promise<void> {
    const content = await readFile(inputPath, "utf-8");
    if (this.isOriginallyJsonl(inputPath)) {
      const decrypted = this.lineEncryptor.decryptFileContent(content, ad);
      await writeFile(outputPath, decrypted);
    } else {
      const decrypted = this.fileEncryptor.decrypt(content, ad);
      await writeFile(outputPath, decrypted);
    }
  }

  async encryptString(input: string, ad: string): Promise<string> {
    return this.fileEncryptor.encryptString(input, ad);
  }

  async decryptString(encrypted: string, ad: string): Promise<string> {
    return this.fileEncryptor.decryptString(encrypted, ad);
  }

  async encryptDirectory(dirPath: string): Promise<void> {
    await this._encryptDirRecursive(dirPath, dirPath);
  }

  private async _encryptDirRecursive(dirPath: string, rootPath: string): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this._encryptDirRecursive(fullPath, rootPath);
      } else if (!entry.name.endsWith(".age")) {
        const ad = relative(rootPath, fullPath);
        await this.encryptFile(fullPath, fullPath + ".age", ad);
        await rm(fullPath);
      }
    }
  }

  async decryptDirectory(dirPath: string): Promise<void> {
    await this._decryptDirRecursive(dirPath, dirPath);
  }

  private async _decryptDirRecursive(dirPath: string, rootPath: string): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this._decryptDirRecursive(fullPath, rootPath);
      } else if (entry.name.endsWith(".age")) {
        const outputPath = fullPath.replace(/\.age$/, "");
        const ad = relative(rootPath, outputPath);
        await this.decryptFile(fullPath, outputPath, ad);
        await rm(fullPath);
      }
    }
  }
}
```

- [ ] **Step 11: Update Encryptor tests**

All `encryptFile(src, enc)` calls become `encryptFile(src, enc, "test-file")`. Same for `decryptFile`. `encryptString(str)` → `encryptString(str, "test-context")`. The directory tests stay unchanged since `encryptDirectory`/`decryptDirectory` compute AD internally.

- [ ] **Step 12: Update push.ts encryptor call site**

In `push.ts` lines 177-183, the encryptor encrypts individual files. Pass the store-relative path as AD:

```typescript
// In the secret-scan encrypt loop (push.ts ~line 179):
for (const filePath of filesToEncrypt) {
  if (existsSync(filePath) && !filePath.endsWith(".age")) {
    const ad = relative(stagingDir, filePath);
    await encryptor.encryptFile(filePath, filePath + ".age", ad);
    await rm(filePath);
  }
}
```

Add `relative` to the `node:path` imports if not already there (it is — line 2).

- [ ] **Step 13: Update pull.ts encryptor call site**

The `Encryptor.decryptDirectory` now computes AD internally from its root, so the pull call sites don't need changes — `encryptor.decryptDirectory(tmpConfigDir)` and `encryptor.decryptDirectory(tmpUnknownDir)` will use relative paths from tmpConfigDir/tmpUnknownDir roots respectively.

However, we need to ensure the AD used during push encryption matches the AD used during pull decryption. Push encrypts files in staging (`<stagingDir>/config/...` or `<stagingDir>/unknown/...`), computing AD relative to `stagingDir`. Pull decrypts from tmpDir (`<tmpDir>/config/...`), computing AD relative to tmpConfigDir or tmpUnknownDir.

**Important**: The push AD for a file at `<stagingDir>/config/projects/session.jsonl` is `config/projects/session.jsonl` (relative to stagingDir). But pull decrypts from `<tmpDir>/config/projects/session.jsonl.age` with decryptDirectory called on tmpConfigDir, yielding AD `projects/session.jsonl` (relative to tmpConfigDir).

These don't match! Fix: In push.ts, compute AD relative to the subdirectory (`configDir` or `unknownDir` within staging), not the staging root. Or better: call `encryptDirectory` on the staging subdirectories instead of encrypting individual secret-flagged files.

Actually the simpler fix is: for the secret-scan encrypt loop in push, compute AD relative to the appropriate subdirectory (staging/config or staging/unknown):

```typescript
for (const filePath of filesToEncrypt) {
  if (existsSync(filePath) && !filePath.endsWith(".age")) {
    // Compute AD relative to config/ or unknown/ subdirectory of staging
    const stagingConfig = join(stagingDir, "config");
    const stagingUnknown = join(stagingDir, "unknown");
    const ad = filePath.startsWith(stagingConfig)
      ? relative(stagingConfig, filePath)
      : relative(stagingUnknown, filePath);
    await encryptor.encryptFile(filePath, filePath + ".age", ad);
    await rm(filePath);
  }
}
```

And pull's `decryptDirectory(tmpConfigDir)` computes AD relative to `tmpConfigDir`, which matches.

- [ ] **Step 14: Run all tests**

Run: `npx vitest run`
Expected: All 88+ tests pass

- [ ] **Step 15: Commit**

```bash
git add src/encryptor/ src/commands/push.ts src/commands/pull.ts tests/encryptor/
git commit -m "feat: bind AES-SIV encryption to file path via associated data"
```

---

## Chunk 2: Path Mapper, Scanner, Merger

### Task 4: Recursive JSON Walk (Design #6)

**Files:**
- Modify: `src/path-mapper/path-mapper.ts:81-85` (replace method)
- Modify: `tests/path-mapper/path-mapper.test.ts` (add edge case tests)

- [ ] **Step 1: Write failing test — keys containing path are not modified**

Add to `tests/path-mapper/path-mapper.test.ts`:

```typescript
it("does not modify object keys that contain the path", () => {
  const settings = {
    "/home/user/.claude/hooks": {
      enabled: true,
    },
  };
  const claudeDir = "/home/user/.claude";
  const result = mapper.normalizeSettingsPaths(settings, claudeDir);
  // Key should NOT be modified (keys are not paths in Claude settings, but this tests robustness)
  expect(result["/home/user/.claude/hooks"]).toBeDefined();
  expect(result["/home/user/.claude/hooks"].enabled).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/path-mapper/path-mapper.test.ts -t "does not modify object keys"`
Expected: FAIL — current replaceInSerialized modifies keys too

- [ ] **Step 3: Replace `replaceInSerialized` with `replaceInValues`**

In `path-mapper.ts`, replace the private method:

```typescript
private replaceInValues<T>(value: T, search: string, replacement: string): T {
  if (typeof value === "string") {
    return value.replaceAll(search, replacement) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => this.replaceInValues(item, search, replacement)) as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = this.replaceInValues(v, search, replacement);
    }
    return result as T;
  }
  return value;
}
```

Update the 4 callers (`normalizeSettingsPaths`, `remapSettingsPaths`, `normalizePluginPaths`, `remapPluginPaths`) to call `this.replaceInValues(...)` instead of `this.replaceInSerialized(...)`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/path-mapper/path-mapper.test.ts`
Expected: All tests pass including new key preservation test

- [ ] **Step 5: Commit**

```bash
git add src/path-mapper/path-mapper.ts tests/path-mapper/path-mapper.test.ts
git commit -m "refactor: replace JSON serialize/replace with recursive tree walk in PathMapper"
```

---

### Task 5: Expanded Secret Scanner Patterns (Design #5)

**Files:**
- Modify: `src/secret-scanner/scanner.ts:10-21` (add patterns)
- Modify: `tests/secret-scanner/scanner.test.ts` (add tests for each new pattern)

- [ ] **Step 1: Write failing tests for new patterns**

Add to `tests/secret-scanner/scanner.test.ts`:

```typescript
it("detects Google API keys", async () => {
  const file = join(tempDir, "config.json");
  await writeFile(file, JSON.stringify({ key: "AIzaSyA1234567890abcdefghijklmnopqrstuv" }));
  const results = await scanner.scanFile(file);
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].pattern).toBe("Google API Key");
});

it("detects Slack bot tokens", async () => {
  const file = join(tempDir, "config.json");
  const token = ["xo" + "xb", "123456789012", "123456789012", "abcdefghijklmnopqrstuvwx"].join("-");
  await writeFile(file, JSON.stringify({ token }));
  const results = await scanner.scanFile(file);
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].pattern).toBe("Slack Bot Token");
});
});

it("detects Stripe live keys", async () => {
  const file = join(tempDir, "config.json");
  const key = "s" + "k_live_" + "abcdefghijklmnopqrstuvwx";
  await writeFile(file, JSON.stringify({ key }));
  const results = await scanner.scanFile(file);
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].pattern).toBe("Stripe Live Key");
});

it("detects Stripe test keys", async () => {
  const file = join(tempDir, "config.json");
  const key = "s" + "k_test_" + "abcdefghijklmnopqrstuvwx";
  await writeFile(file, JSON.stringify({ key }));
  const results = await scanner.scanFile(file);
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].pattern).toBe("Stripe Test Key");
});

it("detects Azure connection strings", async () => {
  const file = join(tempDir, "config.json");
  await writeFile(file, `AccountKey=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH==`);
  const results = await scanner.scanFile(file);
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].pattern).toBe("Azure Connection String");
});

it("detects Twilio API keys", async () => {
  const file = join(tempDir, "config.json");
  const key = "S" + "K" + "0123456789abcdef".repeat(2);
  await writeFile(file, JSON.stringify({ key }));
  const results = await scanner.scanFile(file);
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].pattern).toBe("Twilio API Key");
});

it("detects Datadog API keys", async () => {
  const file = join(tempDir, "config.json");
  await writeFile(file, JSON.stringify({ key: "dd_abcdefghijklmnopqrstuvwxyz012345" }));
  const results = await scanner.scanFile(file);
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].pattern).toBe("Datadog API Key");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/secret-scanner/scanner.test.ts -t "detects Google"`
Expected: FAIL — patterns not yet defined

- [ ] **Step 3: Add new patterns to scanner.ts**

Add after the existing patterns in the `SECRET_PATTERNS` array:

```typescript
// NOTE: Regex prefixes split to avoid triggering GitHub push protection on test tokens.
// See src/secret-scanner/scanner.ts for the actual regex patterns.
{ name: "Google API Key",          regex: /AIza[0-9A-Za-z\-_]{35}/ },
{ name: "Slack Bot Token",         regex: /* xo + xb + -[0-9A-Za-z\-]{50,} */ },
{ name: "Slack User Token",        regex: /* xo + xp + -[0-9A-Za-z\-]{50,} */ },
{ name: "Stripe Live Key",         regex: /* s + k_live_ + [0-9a-zA-Z]{24,} */ },
{ name: "Stripe Test Key",         regex: /* s + k_test_ + [0-9a-zA-Z]{24,} */ },
{ name: "Azure Connection String", regex: /AccountKey=[A-Za-z0-9+/=]{44,}/ },
{ name: "Twilio API Key",          regex: /* S + K + [0-9a-fA-F]{32} */ },
{ name: "Datadog API Key",         regex: /dd[a-z]{0,2}_[0-9a-zA-Z]{32,}/ },
```

**Important**: Place `Stripe Live Key` and `Stripe Test Key` BEFORE the existing `OpenAI API Key` pattern. The OpenAI pattern `sk-(?!ant-)[a-zA-Z0-9]{20,}` would also match `sk_live_...` and `sk_test_...` since the regex uses `sk-` but the Stripe keys use `sk_`. Actually, Stripe uses `sk_live_` (underscore) while OpenAI uses `sk-` (hyphen), so there's no conflict. Place new patterns at the end.

- [ ] **Step 4: Run all scanner tests**

Run: `npx vitest run tests/secret-scanner/scanner.test.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/secret-scanner/scanner.ts tests/secret-scanner/scanner.test.ts
git commit -m "feat: add Google, Slack, Stripe, Azure, Twilio, Datadog secret patterns"
```

---

### Task 6: Smart Array Merge (Design #4)

**Files:**
- Modify: `src/merger/merger.ts` (replace arrayMerge, add findArrayKey)
- Modify: `tests/merger/merger.test.ts` (add array merge tests)

- [ ] **Step 1: Write failing tests for smart array merge**

Add to `tests/merger/merger.test.ts`:

```typescript
describe("smart array merge", () => {
  it("unions arrays of objects by 'name' key", () => {
    const local = { items: [{ name: "a", value: 1 }, { name: "b", value: 2 }] };
    const remote = { items: [{ name: "a", value: 10 }, { name: "c", value: 3 }] };

    const result = merger.deepMergeJson(local, remote);

    // Remote wins on same-key conflict (name: "a"), local-only items preserved
    expect(result.items).toEqual([
      { name: "a", value: 10 },
      { name: "c", value: 3 },
      { name: "b", value: 2 },
    ]);
  });

  it("unions arrays of objects by 'id' key", () => {
    const local = { items: [{ id: "1", data: "local" }] };
    const remote = { items: [{ id: "2", data: "remote" }] };

    const result = merger.deepMergeJson(local, remote);

    expect(result.items).toEqual([
      { id: "2", data: "remote" },
      { id: "1", data: "local" },
    ]);
  });

  it("falls back to remote-wins for primitive arrays", () => {
    const local = { tags: ["a", "b", "c"] };
    const remote = { tags: ["x", "y"] };

    const result = merger.deepMergeJson(local, remote);

    expect(result.tags).toEqual(["x", "y"]);
  });

  it("falls back to remote-wins for arrays of objects without identifiable key", () => {
    const local = { items: [{ value: 1 }, { value: 2 }] };
    const remote = { items: [{ value: 3 }] };

    const result = merger.deepMergeJson(local, remote);

    expect(result.items).toEqual([{ value: 3 }]);
  });

  it("handles empty arrays", () => {
    const local = { items: [{ name: "a", value: 1 }] };
    const remote = { items: [] };

    const result = merger.deepMergeJson(local, remote);

    expect(result.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/merger/merger.test.ts -t "smart array merge"`
Expected: FAIL — current arrayMerge just returns source

- [ ] **Step 3: Implement smart array merge**

```typescript
// merger.ts
import deepmerge from "deepmerge";

export class Merger {
  deepMergeJson(local: Record<string, any>, remote: Record<string, any>): Record<string, any> {
    return deepmerge(local, remote, {
      arrayMerge: (target, source) => {
        const key = this.findArrayKey(source);
        if (!key) return source;

        const remoteKeys = new Set(source.map((item: any) => item[key]));
        const localOnly = target.filter((item: any) => !remoteKeys.has(item[key]));
        return [...source, ...localOnly];
      },
    });
  }

  private findArrayKey(arr: any[]): string | null {
    if (arr.length === 0 || typeof arr[0] !== "object" || arr[0] === null) return null;
    for (const candidate of ["name", "id", "key"]) {
      if (arr.every((item: any) => item !== null && typeof item === "object" && typeof item[candidate] === "string")) {
        return candidate;
      }
    }
    return null;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/merger/merger.test.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/merger/merger.ts tests/merger/merger.test.ts
git commit -m "feat: smart array merge — union by key for objects, remote-wins for primitives"
```

---

## Chunk 3: Pull Safety and Incremental Staging

### Task 7: Pull Cleanup Safety (Design #7)

**Files:**
- Modify: `src/commands/pull.ts` (add startup cleanup, signal handlers)
- Modify: `tests/commands/pull.test.ts` (add stale cleanup test)

- [ ] **Step 1: Write failing test — stale tmp cleanup on startup**

Add to `tests/commands/pull.test.ts`:

```typescript
it("cleans up stale .pull-tmp from previous crash on startup", async () => {
  // Simulate leftover from a crash
  const staleTmpDir = join(pullHomeDir, ".claudefy", ".pull-tmp");
  await mkdir(staleTmpDir, { recursive: true });
  await writeFile(join(staleTmpDir, "leaked-secret.json"), "plaintext secret");

  const pull = new PullCommand(pullHomeDir);
  await pull.execute({ quiet: true, skipEncryption: true });

  // Stale dir should be cleaned up
  expect(existsSync(staleTmpDir)).toBe(false);
  // Pull should still succeed
  const command = await readFile(join(pullHomeDir, ".claude", "commands", "test.md"), "utf-8");
  expect(command).toBe("# Test Command");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/pull.test.ts -t "stale"`
Expected: May pass already since pull creates the tmpDir fresh. Let's check — if `existsSync(tmpDir)` is true, it does `rm -rf` before creating. Actually looking at pull.ts lines 91-92, it already does this! So this test should already pass. But we still need to add the signal handlers.

- [ ] **Step 3: Add signal handlers to pull.ts**

In `pull.ts`, add `rmSync` to the imports and add handlers around the main logic:

```typescript
// Add to imports:
import { existsSync, rmSync } from "node:fs";

// In execute(), after computing tmpDir and before the try block:
const cleanup = () => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Best effort
  }
  process.exit(1);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// In the finally block, add handler removal:
finally {
  if (existsSync(tmpDir)) await rm(tmpDir, { recursive: true });
  process.removeListener("SIGINT", cleanup);
  process.removeListener("SIGTERM", cleanup);
}
```

- [ ] **Step 4: Run all pull tests**

Run: `npx vitest run tests/commands/pull.test.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/commands/pull.ts tests/commands/pull.test.ts
git commit -m "feat: add SIGINT/SIGTERM cleanup handlers for pull temp directory"
```

---

### Task 8: Incremental Staging (Design #3)

This is the biggest change. We're rewriting the core of `push.ts`.

**Files:**
- Modify: `src/commands/push.ts` (major rewrite of execute method)
- Modify: `tests/commands/push.test.ts` (add incremental-specific tests)

- [ ] **Step 1: Write failing test — no-op push doesn't touch unchanged files**

Add to `tests/commands/push.test.ts`:

```typescript
it("skips unchanged files on second push (incremental)", async () => {
  const push = new PushCommand(homeDir);
  await push.execute({ quiet: true, skipEncryption: true });

  // Record store file mtimes
  const storePath = join(homeDir, ".claudefy", "store");
  const settingsPath = join(storePath, "config", "settings.json");
  const stat1 = await import("node:fs/promises").then(fs => fs.stat(settingsPath));
  const mtime1 = stat1.mtimeMs;

  // Wait a bit so mtime would differ if file is rewritten
  await new Promise(resolve => setTimeout(resolve, 50));

  // Push again with no changes
  await push.execute({ quiet: true, skipEncryption: true });

  // File should NOT have been rewritten (same mtime)
  const stat2 = await import("node:fs/promises").then(fs => fs.stat(settingsPath));
  const mtime2 = stat2.mtimeMs;

  expect(mtime2).toBe(mtime1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/push.test.ts -t "skips unchanged"`
Expected: FAIL — current push rewrites all files every time

- [ ] **Step 3: Implement incremental push**

Rewrite `push.ts` `execute()` method. The new flow:

1. Classify files (unchanged)
2. Initialize git adapter (unchanged)
3. Hash existing store files
4. For each classified file: normalize in memory, hash, compare with store, write only if different
5. Detect and remove deleted files
6. Secret scan only changed files
7. Encrypt only changed files with secrets
8. Conditional manifest update (unchanged)
9. Commit and push (unchanged)

```typescript
// New helper method on PushCommand:
private async hashFile(filePath: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

private async hashContent(content: string | Buffer): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(content).digest("hex");
}

private async collectStoreHashes(dirPath: string, prefix: string = ""): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  if (!existsSync(dirPath)) return hashes;
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const sub = await this.collectStoreHashes(fullPath, relPath);
      for (const [k, v] of sub) hashes.set(k, v);
    } else if (!entry.isSymbolicLink()) {
      hashes.set(relPath, await this.hashFile(fullPath));
    }
  }
  return hashes;
}
```

The core execute() logic becomes:

```typescript
async execute(options: PushOptions): Promise<void> {
  // 1-2. Classify + init git (same as before)
  // ...

  const storePath = gitAdapter.getStorePath();
  const configDir = join(storePath, "config");
  const unknownDir = join(storePath, "unknown");

  // 3. Hash existing store files
  const storeConfigHashes = await this.collectStoreHashes(configDir);
  const storeUnknownHashes = await this.collectStoreHashes(unknownDir);

  const changedFiles: string[] = []; // track changed files for secret scanning
  const links = await this.configManager.getLinks();
  const pathMapper = new PathMapper(links);

  // 4. Process allowlisted items — copy only changed files
  for (const item of classification.allowlist) {
    const src = join(this.claudeDir, item.name);
    const destDir = configDir;
    await this.syncItem(src, destDir, item.name, storeConfigHashes, changedFiles, pathMapper);
  }

  // 5. Process unknown items — copy only changed files
  for (const item of classification.unknown) {
    const src = join(this.claudeDir, item.name);
    const destDir = unknownDir;
    await this.syncItem(src, destDir, item.name, storeUnknownHashes, changedFiles, null);
  }

  // 6. Detect deletions
  await this.removeDeleted(configDir, classification.allowlist.map(i => i.name));
  await this.removeDeleted(unknownDir, classification.unknown.map(i => i.name));

  // 7-8. Secret scan + encrypt only changed files
  // (same logic but only scanning changedFiles instead of all files)

  // 9-10. Conditional manifest + commit (same as before)
}
```

The `syncItem` method handles single file or directory copying with hash comparison:

```typescript
private async syncItem(
  srcPath: string,
  destBaseDir: string,
  itemName: string,
  storeHashes: Map<string, string>,
  changedFiles: string[],
  pathMapper: PathMapper | null,
): Promise<void> {
  await mkdir(destBaseDir, { recursive: true });
  const stat = await import("node:fs/promises").then(fs => fs.stat(srcPath));

  if (stat.isFile()) {
    let content = await readFile(srcPath);
    // Apply normalization if needed
    if (pathMapper && this.needsNormalization(itemName)) {
      content = Buffer.from(this.normalizeContent(itemName, content.toString("utf-8"), pathMapper));
    }
    const hash = await this.hashContent(content);
    const storeHash = storeHashes.get(itemName);
    if (hash !== storeHash) {
      const destPath = join(destBaseDir, itemName);
      await writeFile(destPath, content);
      changedFiles.push(destPath);
    }
  } else if (stat.isDirectory()) {
    // Recurse into directory
    await this.syncDirectory(srcPath, destBaseDir, itemName, storeHashes, changedFiles, pathMapper);
  }
}
```

This is the skeleton — the full implementation needs to handle the path normalization cases (settings.json, plugins, history.jsonl, projects/ directory renaming) inline during the sync rather than as a separate pass.

- [ ] **Step 4: Handle normalization inline**

The key insight: normalization (path replacement, JSONL line mapping, project dir renaming) must happen *before* hashing for comparison. Implement `needsNormalization` and `normalizeContent` helpers that handle each case:

- `settings.json` → `pathMapper.normalizeSettingsPaths`
- `plugins/installed_plugins.json` → `pathMapper.normalizePluginPaths`
- `plugins/known_marketplaces.json` → `pathMapper.normalizePluginPaths`
- `history.jsonl` → line-by-line `pathMapper.normalizeJsonlLine`
- `projects/*` → directory renaming via `pathMapper.normalizeDirName`

- [ ] **Step 5: Handle deletion detection**

```typescript
private async removeDeleted(storeDir: string, currentItems: string[]): Promise<void> {
  if (!existsSync(storeDir)) return;
  const entries = await readdir(storeDir);
  const currentSet = new Set(currentItems);
  for (const entry of entries) {
    // Also check for .age version of the item
    const baseName = entry.endsWith(".age") ? entry.slice(0, -4) : entry;
    if (!currentSet.has(baseName) && !currentSet.has(entry)) {
      await rm(join(storeDir, entry), { recursive: true });
    }
  }
}
```

- [ ] **Step 6: Handle encrypted file hashing**

For files that contain secrets and get encrypted: after normalization, encrypt the content in memory (deterministic), hash the encrypted output, and compare against the store's `.age` file hash:

```typescript
// In the secret scan section:
if (findings.length > 0 && willEncrypt && options.passphrase) {
  const encryptor = new Encryptor(options.passphrase);
  const filesToEncrypt = new Set(findings.map(f => f.file));
  for (const filePath of filesToEncrypt) {
    if (existsSync(filePath) && !filePath.endsWith(".age")) {
      const storeDir = filePath.startsWith(configDir) ? configDir : unknownDir;
      const ad = relative(storeDir, filePath);
      // Encrypt in place
      await encryptor.encryptFile(filePath, filePath + ".age", ad);
      await rm(filePath);
    }
  }
}
```

- [ ] **Step 7: Run existing push tests**

Run: `npx vitest run tests/commands/push.test.ts`
Expected: All existing tests must still pass — the external behavior is identical, only the internal mechanism changed.

- [ ] **Step 8: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass including integration tests

- [ ] **Step 9: Commit**

```bash
git add src/commands/push.ts tests/commands/push.test.ts
git commit -m "feat: incremental push — hash-based diff, skip unchanged files, detect deletions"
```

---

## Chunk 4: New Features

### Task 9: Restore Command (Design #9)

**Files:**
- Create: `src/commands/restore.ts`
- Modify: `src/backup-manager/backup-manager.ts` (add `getBackupPath`)
- Modify: `src/cli.ts` (wire command)
- Create: `tests/commands/restore.test.ts`

- [ ] **Step 1: Write failing test for BackupManager.getBackupPath**

Add to `tests/backup-manager/backup-manager.test.ts`:

```typescript
it("resolves backup name to full path", async () => {
  await writeFile(join(claudeDir, "settings.json"), "{}");
  const backupManager = new BackupManager(claudefyDir);

  const backupPath = await backupManager.createBackup(claudeDir, "test-backup");
  const backups = await backupManager.listBackups();
  const resolved = backupManager.getBackupPath(backups[0]);

  expect(resolved).toBe(backupPath);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/backup-manager/backup-manager.test.ts -t "resolves backup"`
Expected: FAIL — method doesn't exist

- [ ] **Step 3: Add `getBackupPath` to BackupManager**

```typescript
getBackupPath(name: string): string {
  return join(this.backupsDir, name);
}
```

- [ ] **Step 4: Run backup-manager tests**

Run: `npx vitest run tests/backup-manager/backup-manager.test.ts`
Expected: All pass

- [ ] **Step 5: Write RestoreCommand tests**

Create `tests/commands/restore.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RestoreCommand } from "../../src/commands/restore.js";
import { BackupManager } from "../../src/backup-manager/backup-manager.js";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

describe("RestoreCommand", () => {
  let homeDir: string;
  let claudeDir: string;
  let claudefyDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "claudefy-restore-test-"));
    claudeDir = join(homeDir, ".claude");
    claudefyDir = join(homeDir, ".claudefy");
    await mkdir(claudeDir, { recursive: true });
    await mkdir(join(claudefyDir, "backups"), { recursive: true });
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  it("restores a backup to ~/.claude", async () => {
    // Create original state
    await writeFile(join(claudeDir, "settings.json"), '{"original": true}');

    // Create a backup
    const backupManager = new BackupManager(claudefyDir);
    await backupManager.createBackup(claudeDir, "test-backup");

    // Change local state
    await writeFile(join(claudeDir, "settings.json"), '{"changed": true}');

    // Restore
    const cmd = new RestoreCommand(homeDir);
    const backups = await backupManager.listBackups();
    await cmd.restoreByName(backups[0], { quiet: true });

    // Verify original content restored
    const settings = await readFile(join(claudeDir, "settings.json"), "utf-8");
    expect(JSON.parse(settings)).toEqual({ original: true });
  });

  it("creates safety backup before restoring", async () => {
    await writeFile(join(claudeDir, "settings.json"), '{"current": true}');

    const backupManager = new BackupManager(claudefyDir);
    await backupManager.createBackup(claudeDir, "old-backup");

    const cmd = new RestoreCommand(homeDir);
    const backups = await backupManager.listBackups();
    await cmd.restoreByName(backups[0], { quiet: true });

    // Should now have 2 backups (original + pre-restore safety)
    const allBackups = await backupManager.listBackups();
    expect(allBackups.length).toBe(2);
    expect(allBackups.some(b => b.includes("pre-restore"))).toBe(true);
  });

  it("returns empty list when no backups exist", async () => {
    const cmd = new RestoreCommand(homeDir);
    const backups = await cmd.listAvailableBackups();
    expect(backups).toEqual([]);
  });
});
```

- [ ] **Step 6: Implement RestoreCommand**

Create `src/commands/restore.ts`:

```typescript
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { BackupManager } from "../backup-manager/backup-manager.js";
import { output } from "../output.js";

export interface RestoreOptions {
  quiet: boolean;
}

export class RestoreCommand {
  private homeDir: string;
  private claudeDir: string;
  private backupManager: BackupManager;

  constructor(homeDir: string) {
    this.homeDir = homeDir;
    this.claudeDir = join(homeDir, ".claude");
    this.backupManager = new BackupManager(join(homeDir, ".claudefy"));
  }

  async listAvailableBackups(): Promise<string[]> {
    return this.backupManager.listBackups();
  }

  async restoreByName(backupName: string, options: RestoreOptions): Promise<void> {
    const backupPath = this.backupManager.getBackupPath(backupName);
    if (!existsSync(backupPath)) {
      throw new Error(`Backup not found: ${backupName}`);
    }

    // Safety backup of current state
    if (existsSync(this.claudeDir)) {
      const safetyPath = await this.backupManager.createBackup(this.claudeDir, "pre-restore");
      if (!options.quiet) {
        output.info(`Safety backup created at: ${safetyPath}`);
      }
    }

    // Wipe and restore
    if (existsSync(this.claudeDir)) {
      await rm(this.claudeDir, { recursive: true });
    }
    await cp(backupPath, this.claudeDir, { recursive: true });

    if (!options.quiet) {
      output.success(`Restored from backup: ${backupName}`);
    }
  }

  async executeInteractive(options: RestoreOptions): Promise<void> {
    const backups = await this.listAvailableBackups();
    if (backups.length === 0) {
      output.info("No backups available.");
      return;
    }

    // Display numbered list
    console.log("\nAvailable backups:\n");
    for (let i = 0; i < backups.length; i++) {
      console.log(`  ${i + 1}. ${backups[i]}`);
    }
    console.log();

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (question: string): Promise<string> =>
      new Promise((resolve) => rl.question(question, resolve));

    try {
      const indexStr = await ask("Enter backup number to restore: ");
      const index = parseInt(indexStr, 10) - 1;
      if (isNaN(index) || index < 0 || index >= backups.length) {
        output.error("Invalid selection.");
        return;
      }

      const selected = backups[index];
      const confirm = await ask(`This will replace ~/.claude with backup "${selected}". Continue? (y/N) `);
      if (confirm.toLowerCase() !== "y") {
        output.info("Restore cancelled.");
        return;
      }

      await this.restoreByName(selected, options);
    } finally {
      rl.close();
    }
  }
}
```

- [ ] **Step 7: Wire into cli.ts**

Add to `cli.ts` after the `doctor` command:

```typescript
program
  .command("restore")
  .description("Restore ~/.claude from a backup")
  .action(async function (this: Command) {
    try {
      const opts = this.optsWithGlobals();
      const quiet = opts.quiet ?? false;
      const { RestoreCommand } = await import("./commands/restore.js");
      const cmd = new RestoreCommand(homeDir);
      await cmd.executeInteractive({ quiet });
    } catch (err: unknown) {
      output.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run tests/commands/restore.test.ts tests/backup-manager/backup-manager.test.ts`
Expected: All pass

- [ ] **Step 9: Commit**

```bash
git add src/commands/restore.ts src/backup-manager/backup-manager.ts src/cli.ts tests/commands/restore.test.ts tests/backup-manager/backup-manager.test.ts
git commit -m "feat: add claudefy restore command with interactive backup picker"
```

---

### Task 10: Lightweight Update Check (Design #10)

**Files:**
- Create: `src/update-check.ts`
- Modify: `src/index.ts` (replace update-notifier)
- Delete: `src/update-notifier.d.ts`
- Create: `tests/update-check.test.ts`

- [ ] **Step 1: Write tests for update check**

Create `tests/update-check.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

// We'll test the internal shouldCheck and cache logic, not the actual fetch
describe("update-check", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claudefy-update-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates cache file after check", async () => {
    const { shouldCheck, writeCache } = await import("../src/update-check.js");

    // No cache file yet — should check
    expect(await shouldCheck(tempDir)).toBe(true);

    // Write cache
    await writeCache(tempDir, "1.2.0");

    // Should not check again (within 24h)
    expect(await shouldCheck(tempDir)).toBe(false);
  });

  it("rechecks after cache expires", async () => {
    const { shouldCheck, CACHE_FILE } = await import("../src/update-check.js");

    // Write expired cache (timestamp from 25 hours ago)
    const cachePath = join(tempDir, CACHE_FILE);
    const expired = JSON.stringify({
      lastCheck: Date.now() - 25 * 60 * 60 * 1000,
      latestVersion: "1.1.0",
    });
    await writeFile(cachePath, expired);

    expect(await shouldCheck(tempDir)).toBe(true);
  });
});
```

- [ ] **Step 2: Implement update-check.ts**

Create `src/update-check.ts`:

```typescript
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export const CACHE_FILE = "update-check.json";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REGISTRY_URL = "https://registry.npmjs.org/@kodrunhq/claudefy/latest";
const FETCH_TIMEOUT_MS = 3000;

interface CacheData {
  lastCheck: number;
  latestVersion: string;
}

export async function shouldCheck(claudefyDir: string): Promise<boolean> {
  const cachePath = join(claudefyDir, CACHE_FILE);
  if (!existsSync(cachePath)) return true;
  try {
    const data: CacheData = JSON.parse(await readFile(cachePath, "utf-8"));
    return Date.now() - data.lastCheck > CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
}

export async function writeCache(claudefyDir: string, latestVersion: string): Promise<void> {
  await mkdir(claudefyDir, { recursive: true });
  const cachePath = join(claudefyDir, CACHE_FILE);
  const data: CacheData = { lastCheck: Date.now(), latestVersion };
  await writeFile(cachePath, JSON.stringify(data));
}

async function getCachedVersion(claudefyDir: string): Promise<string | null> {
  const cachePath = join(claudefyDir, CACHE_FILE);
  if (!existsSync(cachePath)) return null;
  try {
    const data: CacheData = JSON.parse(await readFile(cachePath, "utf-8"));
    return data.latestVersion;
  } catch {
    return null;
  }
}

function isNewer(latest: string, current: string): boolean {
  const l = latest.split(".").map(Number);
  const c = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
}

export async function checkForUpdates(currentVersion: string, claudefyDir: string): Promise<void> {
  try {
    // Only fetch if interval elapsed; otherwise check cache
    if (!(await shouldCheck(claudefyDir))) {
      const cached = await getCachedVersion(claudefyDir);
      if (cached && isNewer(cached, currentVersion)) {
        process.stderr.write(
          `\nUpdate available: ${currentVersion} → ${cached} — run "npm update -g @kodrunhq/claudefy"\n\n`,
        );
      }
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return;
    const data = (await res.json()) as { version?: string };
    if (!data.version) return;

    await writeCache(claudefyDir, data.version);

    if (isNewer(data.version, currentVersion)) {
      process.stderr.write(
        `\nUpdate available: ${currentVersion} → ${data.version} — run "npm update -g @kodrunhq/claudefy"\n\n`,
      );
    }
  } catch {
    // Silent on any failure
  }
}
```

- [ ] **Step 3: Update index.ts to use new check**

Replace the update-notifier block in `src/index.ts`:

```typescript
#!/usr/bin/env node
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { program } from "./cli.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string };

// Non-blocking update check (cached for 1 day)
const isQuiet = process.argv.includes("-q") || process.argv.includes("--quiet");

if (process.stdout.isTTY && !isQuiet) {
  import("./update-check.js")
    .then(({ checkForUpdates }) => {
      checkForUpdates(pkg.version, join(homedir(), ".claudefy"));
    })
    .catch(() => {});
}

program.parse();
```

- [ ] **Step 4: Delete `src/update-notifier.d.ts`**

Remove the file.

- [ ] **Step 5: Remove `update-notifier` from dependencies**

Run: `npm uninstall update-notifier`

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/update-check.test.ts`
Expected: All pass

Run: `npx vitest run`
Expected: Full suite passes

- [ ] **Step 7: Commit**

```bash
git add src/update-check.ts src/index.ts src/cli.ts package.json package-lock.json tests/update-check.test.ts
git rm src/update-notifier.d.ts
git commit -m "feat: replace update-notifier with lightweight built-in fetch check"
```

---

## Final Verification

- [ ] **Run full test suite**: `npx vitest run`
- [ ] **Run linter**: `npx eslint src/ tests/`
- [ ] **Run formatter check**: `npx prettier --check src/ tests/`
- [ ] **Build**: `npx tsc`
- [ ] **Verify all 10 commits are in order**: `git log --oneline -10`
