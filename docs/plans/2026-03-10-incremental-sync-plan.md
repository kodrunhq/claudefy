# Incremental Sync Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace nuke-and-rebuild sync with incremental push, per-machine git branches, and deterministic AES-256-SIV encryption.

**Architecture:** Each machine pushes to its own git branch (`machines/<machineId>`), with `main` as the merged state. Encryption uses deterministic AES-256-SIV — per-line for `.jsonl` files (enabling git merge), file-level for everything else. Push uses a staging directory for atomicity. Pull decrypts into a temp directory, never modifying the store.

**Tech Stack:** `@noble/ciphers` (AES-SIV), `@noble/hashes` (HMAC-SHA256 key derivation), `simple-git`, `vitest`

**Spec:** `docs/plans/2026-03-10-incremental-sync-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `src/encryptor/line-encryptor.ts` | Per-line AES-256-SIV encryption/decryption for `.jsonl` files |
| `src/encryptor/file-encryptor.ts` | File-level AES-256-SIV deterministic encryption/decryption |
| `src/encryptor/key-derivation.ts` | HMAC-SHA256 key derivation from passphrase + salt |
| `tests/encryptor/line-encryptor.test.ts` | Tests for per-line encryption |
| `tests/encryptor/file-encryptor.test.ts` | Tests for file-level encryption |

### Modified files
| File | Changes |
|------|---------|
| `src/encryptor/encryptor.ts` | Delegate to line-encryptor/file-encryptor, remove age dependency |
| `src/git-adapter/git-adapter.ts` | Per-machine branches, merge to main, return success/failure from commitAndPush |
| `src/commands/push.ts` | Incremental copy, staging dir, branch logic, conditional manifest, path traversal fix |
| `src/commands/pull.ts` | Temp working dir for decrypt, no re-encrypt, branch merge, preserve non-claudefy hooks |
| `src/commands/override.ts` | Force-update main to machine branch |
| `src/commands/join.ts` | Register after pull instead of before |
| `src/machine-registry/machine-registry.ts` | Add conditional update method |
| `tests/encryptor/encryptor.test.ts` | Update for new encryption backend |
| `tests/git-adapter/git-adapter.test.ts` | Test branch operations |
| `tests/commands/push.test.ts` | Test incremental push, staging, conditional manifest |
| `tests/commands/pull.test.ts` | Test temp dir decrypt, no re-encrypt, hook preservation |
| `tests/commands/override.test.ts` | Test branch-based override |
| `tests/commands/join.test.ts` | Test register-after-pull order |
| `tests/machine-registry/machine-registry.test.ts` | Test conditional update |
| `tests/integration/full-sync.test.ts` | Update for branch-based sync |
| `package.json` | Remove `age-encryption`, add `@noble/ciphers` + `@noble/hashes` (already installed) |

### Removed dependencies
| Package | Reason |
|---------|--------|
| `age-encryption` | Replaced by `@noble/ciphers` AES-SIV |

---

## Chunk 1: Deterministic Encryption Core

### Task 1: Key Derivation Module

**Files:**
- Create: `src/encryptor/key-derivation.ts`

- [ ] **Step 1: Write key-derivation.ts**

```typescript
// src/encryptor/key-derivation.ts
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

const LINE_SALT = "claudefy-line-v1";
const FILE_SALT = "claudefy-file-v1";

export function deriveLineKey(passphrase: string): Uint8Array {
  return hmac(sha256, new TextEncoder().encode(passphrase), new TextEncoder().encode(LINE_SALT));
}

export function deriveFileKey(passphrase: string): Uint8Array {
  return hmac(sha256, new TextEncoder().encode(passphrase), new TextEncoder().encode(FILE_SALT));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/encryptor/key-derivation.ts
git commit -m "feat: add HMAC-SHA256 key derivation for AES-SIV encryption"
```

---

### Task 2: Per-Line Encryptor

**Files:**
- Create: `src/encryptor/line-encryptor.ts`
- Create: `tests/encryptor/line-encryptor.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/encryptor/line-encryptor.test.ts
import { describe, it, expect } from "vitest";
import { LineEncryptor } from "../../src/encryptor/line-encryptor.js";

describe("LineEncryptor", () => {
  const passphrase = "test-passphrase-2024";
  const encryptor = new LineEncryptor(passphrase);

  describe("encryptLine / decryptLine", () => {
    it("encrypts and decrypts a single line", () => {
      const line = '{"role":"user","content":"hello world"}';
      const encrypted = encryptor.encryptLine(line);
      expect(encrypted).not.toBe(line);
      expect(encryptor.decryptLine(encrypted)).toBe(line);
    });

    it("is deterministic — same input produces same output", () => {
      const line = '{"role":"assistant","content":"some response"}';
      const enc1 = encryptor.encryptLine(line);
      const enc2 = encryptor.encryptLine(line);
      expect(enc1).toBe(enc2);
    });

    it("produces different output for different lines", () => {
      const enc1 = encryptor.encryptLine("line one");
      const enc2 = encryptor.encryptLine("line two");
      expect(enc1).not.toBe(enc2);
    });

    it("handles empty string", () => {
      const encrypted = encryptor.encryptLine("");
      expect(encryptor.decryptLine(encrypted)).toBe("");
    });

    it("handles unicode content", () => {
      const line = '{"content":"emoji: 🎉 and CJK: 你好"}';
      const encrypted = encryptor.encryptLine(line);
      expect(encryptor.decryptLine(encrypted)).toBe(line);
    });

    it("handles very long lines (10KB+)", () => {
      const line = '{"content":"' + "x".repeat(10000) + '"}';
      const encrypted = encryptor.encryptLine(line);
      expect(encryptor.decryptLine(encrypted)).toBe(line);
    });
  });

  describe("encryptLines / decryptLines", () => {
    it("encrypts and decrypts multiple lines preserving order", () => {
      const lines = [
        '{"role":"user","content":"question"}',
        '{"role":"assistant","content":"answer"}',
        '{"role":"user","content":"follow-up"}',
      ];
      const encrypted = encryptor.encryptLines(lines);
      expect(encrypted).toHaveLength(3);
      expect(encryptor.decryptLines(encrypted)).toEqual(lines);
    });

    it("is deterministic across multiple calls", () => {
      const lines = ["line1", "line2", "line3"];
      const enc1 = encryptor.encryptLines(lines);
      const enc2 = encryptor.encryptLines(lines);
      expect(enc1).toEqual(enc2);
    });

    it("unchanged lines produce identical encrypted output", () => {
      const original = ["line1", "line2", "line3"];
      const appended = ["line1", "line2", "line3", "line4"];
      const encOriginal = encryptor.encryptLines(original);
      const encAppended = encryptor.encryptLines(appended);
      // First 3 lines should be identical
      expect(encAppended.slice(0, 3)).toEqual(encOriginal);
    });
  });

  describe("encryptFile / decryptFile", () => {
    it("encrypts a .jsonl file line-by-line and decrypts back", () => {
      const content = '{"a":1}\n{"b":2}\n{"c":3}\n';
      const encrypted = encryptor.encryptFileContent(content);
      expect(encryptor.decryptFileContent(encrypted)).toBe(content);
    });

    it("handles trailing newline correctly", () => {
      const content = '{"a":1}\n';
      const encrypted = encryptor.encryptFileContent(content);
      expect(encryptor.decryptFileContent(encrypted)).toBe(content);
    });

    it("handles empty file", () => {
      const encrypted = encryptor.encryptFileContent("");
      expect(encryptor.decryptFileContent(encrypted)).toBe("");
    });
  });

  describe("different passphrases", () => {
    it("cannot decrypt with wrong passphrase", () => {
      const other = new LineEncryptor("wrong-passphrase");
      const encrypted = encryptor.encryptLine("secret data");
      expect(() => other.decryptLine(encrypted)).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/encryptor/line-encryptor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/encryptor/line-encryptor.ts
import { aessiv } from "@noble/ciphers/aes.js";
import { deriveLineKey } from "./key-derivation.js";

export class LineEncryptor {
  private key: Uint8Array;

  constructor(passphrase: string) {
    this.key = deriveLineKey(passphrase);
  }

  encryptLine(line: string): string {
    const cipher = aessiv(this.key, new Uint8Array(0));
    const plaintext = new TextEncoder().encode(line);
    const encrypted = cipher.encrypt(plaintext);
    return Buffer.from(encrypted).toString("base64");
  }

  decryptLine(encoded: string): string {
    const cipher = aessiv(this.key, new Uint8Array(0));
    const encrypted = new Uint8Array(Buffer.from(encoded, "base64"));
    const decrypted = cipher.decrypt(encrypted);
    return new TextDecoder().decode(decrypted);
  }

  encryptLines(lines: string[]): string[] {
    return lines.map((line) => this.encryptLine(line));
  }

  decryptLines(encrypted: string[]): string[] {
    return encrypted.map((line) => this.decryptLine(line));
  }

  encryptFileContent(content: string): string {
    if (content === "") return "";
    const lines = content.endsWith("\n")
      ? content.slice(0, -1).split("\n")
      : content.split("\n");
    const encrypted = this.encryptLines(lines);
    return encrypted.join("\n") + "\n";
  }

  decryptFileContent(content: string): string {
    if (content === "" || content.trim() === "") return "";
    const lines = content.endsWith("\n")
      ? content.slice(0, -1).split("\n")
      : content.split("\n");
    const decrypted = this.decryptLines(lines);
    return decrypted.join("\n") + "\n";
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/encryptor/line-encryptor.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/encryptor/line-encryptor.ts tests/encryptor/line-encryptor.test.ts
git commit -m "feat: add per-line deterministic AES-SIV encryptor for .jsonl files"
```

---

### Task 3: File-Level Encryptor

**Files:**
- Create: `src/encryptor/file-encryptor.ts`
- Create: `tests/encryptor/file-encryptor.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/encryptor/file-encryptor.test.ts
import { describe, it, expect } from "vitest";
import { FileEncryptor } from "../../src/encryptor/file-encryptor.js";

describe("FileEncryptor", () => {
  const passphrase = "test-passphrase-2024";
  const encryptor = new FileEncryptor(passphrase);

  describe("encrypt / decrypt", () => {
    it("encrypts and decrypts binary content", () => {
      const data = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
      const encrypted = encryptor.encrypt(data);
      expect(encryptor.decrypt(encrypted)).toEqual(data);
    });

    it("encrypts and decrypts string content", () => {
      const text = '{"key":"value","nested":{"a":1}}';
      const encrypted = encryptor.encryptString(text);
      expect(encryptor.decryptString(encrypted)).toBe(text);
    });

    it("is deterministic — same input produces same output", () => {
      const data = new TextEncoder().encode("test content");
      const enc1 = encryptor.encrypt(data);
      const enc2 = encryptor.encrypt(data);
      expect(enc1).toBe(enc2);
    });

    it("produces different output for different content", () => {
      const enc1 = encryptor.encryptString("content A");
      const enc2 = encryptor.encryptString("content B");
      expect(enc1).not.toBe(enc2);
    });

    it("handles empty content", () => {
      const encrypted = encryptor.encryptString("");
      expect(encryptor.decryptString(encrypted)).toBe("");
    });

    it("handles large content (1MB)", () => {
      const large = "x".repeat(1024 * 1024);
      const encrypted = encryptor.encryptString(large);
      expect(encryptor.decryptString(encrypted)).toBe(large);
    });
  });

  describe("different passphrases", () => {
    it("cannot decrypt with wrong passphrase", () => {
      const other = new FileEncryptor("wrong-passphrase");
      const encrypted = encryptor.encryptString("secret");
      expect(() => other.decryptString(encrypted)).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/encryptor/file-encryptor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/encryptor/file-encryptor.ts
import { aessiv } from "@noble/ciphers/aes.js";
import { deriveFileKey } from "./key-derivation.js";

export class FileEncryptor {
  private key: Uint8Array;

  constructor(passphrase: string) {
    this.key = deriveFileKey(passphrase);
  }

  encrypt(data: Uint8Array): string {
    const cipher = aessiv(this.key, new Uint8Array(0));
    const encrypted = cipher.encrypt(data);
    return Buffer.from(encrypted).toString("base64");
  }

  decrypt(encoded: string): Uint8Array {
    const cipher = aessiv(this.key, new Uint8Array(0));
    const encrypted = new Uint8Array(Buffer.from(encoded, "base64"));
    return cipher.decrypt(encrypted);
  }

  encryptString(text: string): string {
    if (text === "") return "";
    return this.encrypt(new TextEncoder().encode(text));
  }

  decryptString(encoded: string): string {
    if (encoded === "") return "";
    const decrypted = this.decrypt(encoded);
    return new TextDecoder().decode(decrypted);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/encryptor/file-encryptor.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/encryptor/file-encryptor.ts tests/encryptor/file-encryptor.test.ts
git commit -m "feat: add file-level deterministic AES-SIV encryptor"
```

---

### Task 4: Update Encryptor Facade

**Files:**
- Modify: `src/encryptor/encryptor.ts`
- Modify: `tests/encryptor/encryptor.test.ts`

- [ ] **Step 1: Rewrite encryptor.ts to delegate to new modules**

Replace the age-based implementation with a facade over LineEncryptor and FileEncryptor:

```typescript
// src/encryptor/encryptor.ts
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

  async encryptFile(inputPath: string, outputPath: string): Promise<void> {
    if (this.isJsonlFile(inputPath)) {
      const content = await readFile(inputPath, "utf-8");
      const encrypted = this.lineEncryptor.encryptFileContent(content);
      await writeFile(outputPath, encrypted);
    } else {
      const data = await readFile(inputPath);
      const encrypted = this.fileEncryptor.encrypt(new Uint8Array(data));
      await writeFile(outputPath, encrypted);
    }
  }

  async decryptFile(inputPath: string, outputPath: string): Promise<void> {
    const content = await readFile(inputPath, "utf-8");
    if (this.isOriginallyJsonl(inputPath)) {
      const decrypted = this.lineEncryptor.decryptFileContent(content);
      await writeFile(outputPath, decrypted);
    } else {
      const decrypted = this.fileEncryptor.decrypt(content);
      await writeFile(outputPath, decrypted);
    }
  }

  private isOriginallyJsonl(agePath: string): boolean {
    // .jsonl.age -> originally a .jsonl file
    return agePath.endsWith(".jsonl.age");
  }

  async encryptString(input: string): Promise<string> {
    return this.fileEncryptor.encryptString(input);
  }

  async decryptString(encrypted: string): Promise<string> {
    return this.fileEncryptor.decryptString(encrypted);
  }

  async encryptDirectory(dirPath: string): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.encryptDirectory(fullPath);
      } else if (!entry.name.endsWith(".age")) {
        await this.encryptFile(fullPath, fullPath + ".age");
        await rm(fullPath);
      }
    }
  }

  async decryptDirectory(dirPath: string): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.decryptDirectory(fullPath);
      } else if (entry.name.endsWith(".age")) {
        const outputPath = fullPath.replace(/\.age$/, "");
        await this.decryptFile(fullPath, outputPath);
        await rm(fullPath);
      }
    }
  }
}
```

- [ ] **Step 2: Update encryptor tests for new backend**

Update `tests/encryptor/encryptor.test.ts` — the API surface is the same but remove any age-specific assertions. The existing tests for `encryptFile`/`decryptFile`/`encryptDirectory`/`decryptDirectory` should still pass as-is since the interface didn't change.

Key changes:
- Verify determinism (encrypt same file twice → identical output)
- Verify `.jsonl` files use per-line encryption (output is line-based text, not binary)
- Verify non-`.jsonl` files use file-level encryption (output is single base64 string)

- [ ] **Step 3: Run all encryptor tests**

Run: `npx vitest run tests/encryptor/`
Expected: All PASS

- [ ] **Step 4: Remove age-encryption dependency**

```bash
npm uninstall age-encryption
```

- [ ] **Step 5: Run full test suite to check nothing else broke**

Run: `npx vitest run`
Expected: All 88 tests PASS (some command tests may need updates if they mock the old Encryptor internals)

- [ ] **Step 6: Commit**

```bash
git add src/encryptor/encryptor.ts tests/encryptor/encryptor.test.ts package.json package-lock.json
git commit -m "refactor: replace age encryption with deterministic AES-SIV"
```

---

## Chunk 2: Git Adapter Branch Support

### Task 5: Add Branch Operations to GitAdapter

**Files:**
- Modify: `src/git-adapter/git-adapter.ts`
- Modify: `tests/git-adapter/git-adapter.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/git-adapter/git-adapter.test.ts`:

```typescript
describe("branch operations", () => {
  it("creates and switches to a machine branch", async () => {
    await gitAdapter.initStore(remoteUrl);
    await gitAdapter.ensureMachineBranch("machine-laptop");
    const branch = await gitAdapter.getCurrentBranch();
    expect(branch).toBe("machines/machine-laptop");
  });

  it("commits to machine branch and merges to main", async () => {
    await gitAdapter.initStore(remoteUrl);
    await gitAdapter.ensureMachineBranch("machine-laptop");
    // Create a file to commit
    await writeFile(join(storePath, "test.txt"), "hello");
    const result = await gitAdapter.commitAndPush("test commit", "machine-laptop");
    expect(result.committed).toBe(true);
    expect(result.mergedToMain).toBe(true);
  });

  it("returns committed=false when store is clean", async () => {
    await gitAdapter.initStore(remoteUrl);
    await gitAdapter.ensureMachineBranch("machine-laptop");
    const result = await gitAdapter.commitAndPush("no changes", "machine-laptop");
    expect(result.committed).toBe(false);
    expect(result.mergedToMain).toBe(false);
  });

  it("pulls main and merges into machine branch", async () => {
    await gitAdapter.initStore(remoteUrl);
    await gitAdapter.ensureMachineBranch("machine-laptop");
    await gitAdapter.pullAndMergeMain();
    // Should not throw, branch should be up to date
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/git-adapter/git-adapter.test.ts`
Expected: FAIL — methods not found

- [ ] **Step 3: Add branch methods to git-adapter.ts**

Add to `GitAdapter` class:

```typescript
interface CommitResult {
  committed: boolean;
  pushed: boolean;
  mergedToMain: boolean;
}

async ensureMachineBranch(machineId: string): Promise<void> {
  this.ensureInitialized();
  const branchName = `machines/${machineId}`;
  const branches = await this.git!.branchLocal();

  if (branches.all.includes(branchName)) {
    await this.git!.checkout(branchName);
  } else {
    // Check if remote branch exists
    try {
      await this.git!.fetch("origin", branchName);
      await this.git!.checkout(["-b", branchName, `origin/${branchName}`]);
    } catch {
      // No remote branch, create new local branch from current HEAD
      await this.git!.checkoutLocalBranch(branchName);
    }
  }
}

async getCurrentBranch(): Promise<string> {
  this.ensureInitialized();
  const status = await this.git!.status();
  return status.current ?? "";
}

async commitAndPush(message: string, machineId?: string): Promise<CommitResult> {
  this.ensureInitialized();
  await this.git!.add(".");
  const status = await this.git!.status();

  if (status.isClean()) {
    return { committed: false, pushed: false, mergedToMain: false };
  }

  await this.git!.commit(message);

  // Push machine branch
  const currentBranch = await this.getCurrentBranch();
  try {
    await this.git!.push(["-u", "origin", currentBranch]);
  } catch {
    return { committed: true, pushed: false, mergedToMain: false };
  }

  // Merge into main if on a machine branch
  if (!machineId) {
    return { committed: true, pushed: true, mergedToMain: false };
  }

  let mergedToMain = false;
  try {
    await this.git!.checkout("main");
    await this.git!.pull("origin", "main");
    await this.git!.merge([currentBranch]);
    await this.git!.push("origin", "main");
    mergedToMain = true;
  } catch {
    // Main merge failed — that's OK, machine branch is safe
  } finally {
    // Always return to machine branch
    await this.git!.checkout(currentBranch);
  }

  return { committed: true, pushed: true, mergedToMain };
}

async pullAndMergeMain(): Promise<void> {
  this.ensureInitialized();
  const currentBranch = await this.getCurrentBranch();

  try {
    await this.git!.fetch("origin");
  } catch {
    // Offline or fresh store — continue with local state
    return;
  }

  // Update local main
  try {
    await this.git!.checkout("main");
    await this.git!.pull("origin", "main");
  } catch {
    // main might not exist on remote yet
    try {
      await this.git!.checkout("main");
    } catch {
      // No local main either — nothing to merge
      await this.git!.checkout(currentBranch);
      return;
    }
  }

  // Merge main into machine branch
  await this.git!.checkout(currentBranch);
  try {
    await this.git!.merge(["main"]);
  } catch {
    // Merge conflict — accept current branch state (machine wins on conflict)
    await this.git!.merge(["--abort"]).catch(() => {});
  }
}
```

Also update the existing `commitAndPush(message: string)` signature to maintain backward compatibility — the old signature (no machineId) should still work for override and other callers that don't use branches.

- [ ] **Step 4: Update wipeAndPush for branch-based override**

Replace the existing `wipeAndPush` in git-adapter.ts:

```typescript
async wipeAndPush(machineId: string): Promise<void> {
  this.ensureInitialized();
  const machineBranch = `machines/${machineId}`;

  // Wipe all files except .git
  const entries = await readdir(this.storePath);
  for (const entry of entries) {
    if (entry === ".git") continue;
    await rm(join(this.storePath, entry), { recursive: true, force: true });
  }

  await this.writeOverrideMarker(machineId);
  await this.git!.add(".");
  await this.git!.commit(`override: ${machineId} at ${new Date().toISOString()}`);

  // Force-update main to match machine branch state
  const currentBranch = await this.getCurrentBranch();
  if (currentBranch !== "main") {
    await this.git!.checkout("main");
    await this.git!.reset(["--hard", currentBranch]);
    await this.git!.push(["--force", "origin", "main"]);
    await this.git!.checkout(currentBranch);
    await this.git!.push(["-u", "--force", "origin", currentBranch]);
  } else {
    await this.git!.push(["--force"]);
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/git-adapter/git-adapter.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/git-adapter/git-adapter.ts tests/git-adapter/git-adapter.test.ts
git commit -m "feat: add per-machine branch support to GitAdapter"
```

---

## Chunk 3: Incremental Push with Staging

### Task 6: Machine Registry Conditional Update

**Files:**
- Modify: `src/machine-registry/machine-registry.ts`
- Modify: `tests/machine-registry/machine-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/machine-registry/machine-registry.test.ts`:

```typescript
it("conditionalRegister only updates when shouldUpdate is true", async () => {
  await registry.register("m1", "host1", "linux");
  const before = (await registry.list())[0].lastSync;

  // Wait a tick so timestamps differ
  await new Promise((r) => setTimeout(r, 10));

  await registry.conditionalRegister("m1", "host1", "linux", false);
  const after = (await registry.list())[0].lastSync;
  expect(after).toBe(before);
});

it("conditionalRegister updates when shouldUpdate is true", async () => {
  await registry.register("m1", "host1", "linux");
  const before = (await registry.list())[0].lastSync;

  await new Promise((r) => setTimeout(r, 10));

  await registry.conditionalRegister("m1", "host1", "linux", true);
  const after = (await registry.list())[0].lastSync;
  expect(after).not.toBe(before);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/machine-registry/machine-registry.test.ts`
Expected: FAIL — method not found

- [ ] **Step 3: Add conditionalRegister method**

Add to `MachineRegistry` in `src/machine-registry/machine-registry.ts`:

```typescript
async conditionalRegister(
  machineId: string,
  hostname: string,
  os: string,
  shouldUpdate: boolean,
): Promise<void> {
  const manifest = await this.loadManifest();
  const existing = manifest.machines.find((m) => m.machineId === machineId);

  if (existing) {
    if (!shouldUpdate) return;
    existing.hostname = hostname;
    existing.os = os;
    existing.lastSync = new Date().toISOString();
  } else {
    // Always register new machines
    manifest.machines.push({
      machineId,
      hostname,
      os,
      lastSync: new Date().toISOString(),
      registeredAt: new Date().toISOString(),
    });
  }

  await this.saveManifest(manifest);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/machine-registry/machine-registry.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/machine-registry/machine-registry.ts tests/machine-registry/machine-registry.test.ts
git commit -m "feat: add conditional manifest update to MachineRegistry"
```

---

### Task 7: Rewrite PushCommand — Incremental Copy with Staging

**Files:**
- Modify: `src/commands/push.ts`
- Modify: `tests/commands/push.test.ts`

This is the largest task. The push pipeline is rewritten to:
1. Use staging directory for atomicity
2. Incremental copy instead of nuke-and-rebuild
3. Detect and remove deleted files
4. Conditional manifest update
5. Per-machine branch commit
6. Path traversal containment check on dir rename

- [ ] **Step 1: Write/update failing tests**

Update `tests/commands/push.test.ts` with new tests:

```typescript
describe("incremental push", () => {
  it("only commits changed files — unchanged files produce no diff", async () => {
    // First push: creates all files
    await push.execute(options);

    // Second push: no changes to ~/.claude
    await push.execute(options);

    // Git log should show only 1 commit (or 0 changes on second push)
    const git = simpleGit(storePath);
    const log = await git.log();
    // Second push should not create a commit if nothing changed
    expect(log.total).toBeLessThanOrEqual(2); // initial + first push
  });

  it("detects deleted files and removes them from store", async () => {
    await push.execute(options);
    // Delete a file from ~/.claude
    await rm(join(claudeDir, "settings.json"));
    await push.execute(options);
    expect(existsSync(join(storePath, "config", "settings.json"))).toBe(false);
  });

  it("does not update manifest when nothing changed", async () => {
    await push.execute(options);
    const manifest1 = JSON.parse(
      await readFile(join(storePath, "manifest.json"), "utf-8"),
    );
    const lastSync1 = manifest1.machines[0].lastSync;

    await new Promise((r) => setTimeout(r, 10));
    await push.execute(options);

    const manifest2 = JSON.parse(
      await readFile(join(storePath, "manifest.json"), "utf-8"),
    );
    const lastSync2 = manifest2.machines[0].lastSync;
    expect(lastSync2).toBe(lastSync1);
  });
});

describe("staging atomicity", () => {
  it("preserves store state if push fails during processing", async () => {
    // First successful push
    await push.execute(options);
    const settingsBefore = await readFile(
      join(storePath, "config", "settings.json"),
      "utf-8",
    );

    // Corrupt ~/.claude to cause push failure, then verify store unchanged
    // (specific corruption depends on what can fail — e.g., invalid JSON in settings)
  });
});

describe("path traversal protection", () => {
  it("rejects directory renames that escape projects/", async () => {
    // Set up links config with a malicious canonical ID
    // Verify the rename is skipped and a warning is logged
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands/push.test.ts`
Expected: FAIL — behavior doesn't match new expectations

- [ ] **Step 3: Rewrite push.ts**

The full rewrite of `src/commands/push.ts`:

Key changes:
- Replace `rm(configDir)` + `rm(unknownDir)` with incremental `cp` with `force: true`
- Add staging directory: process in `.staging/`, swap on success
- Add deleted file detection: walk store dirs, remove files not in current classification
- Add path traversal containment check on project dir renames (match pull.ts pattern)
- Use `conditionalRegister` — only update manifest when git has real changes
- Use `gitAdapter.ensureMachineBranch()` and pass `machineId` to `commitAndPush()`

```typescript
// Key structural changes to push.ts execute():

// 2. Initialize git adapter
const gitAdapter = new GitAdapter(join(this.homeDir, ".claudefy"));
await gitAdapter.initStore(config.backend.url);
await gitAdapter.ensureMachineBranch(config.machineId);
await gitAdapter.pullAndMergeMain();

const storePath = gitAdapter.getStorePath();
const stagingDir = join(storePath, ".staging");
const configDir = join(storePath, "config");
const unknownDir = join(storePath, "unknown");

try {
  // 3. Prepare staging directory
  if (existsSync(stagingDir)) await rm(stagingDir, { recursive: true });
  await mkdir(join(stagingDir, "config"), { recursive: true });
  await mkdir(join(stagingDir, "unknown"), { recursive: true });

  // 4. Copy allowlisted items to staging
  for (const item of classification.allowlist) {
    const src = join(this.claudeDir, item.name);
    const dest = join(stagingDir, "config", item.name);
    await cp(src, dest, { recursive: true });
  }

  // 5. Copy unknown items to staging
  for (const item of classification.unknown) {
    const src = join(this.claudeDir, item.name);
    const dest = join(stagingDir, "unknown", item.name);
    await cp(src, dest, { recursive: true });
  }

  // 6. Normalize paths in staging (same as before, but in staging dir)
  // ... path normalization code targeting stagingDir ...

  // 7. Project dir rename with path traversal check
  const projectsDir = join(stagingDir, "config", "projects");
  if (existsSync(projectsDir)) {
    const projectDirs = await readdir(projectsDir);
    for (const dirName of projectDirs) {
      const canonicalId = pathMapper.normalizeDirName(dirName);
      if (canonicalId) {
        const destPath = resolve(join(projectsDir, canonicalId));
        if (!destPath.startsWith(resolve(projectsDir) + "/")) {
          output.warn(`Skipping directory rename "${dirName}": path escapes projects directory`);
          continue;
        }
        await rename(join(projectsDir, dirName), destPath);
      }
    }
  }

  // 8. Scan secrets + encrypt in staging
  // ... secret scanning and encryption code targeting stagingDir ...

  // 9. Swap staging into real directories
  if (existsSync(configDir)) await rm(configDir, { recursive: true });
  if (existsSync(unknownDir)) await rm(unknownDir, { recursive: true });
  await rename(join(stagingDir, "config"), configDir);
  await rename(join(stagingDir, "unknown"), unknownDir);

} finally {
  // Clean up staging on success or failure
  if (existsSync(stagingDir)) await rm(stagingDir, { recursive: true });
}

// 10. Check if there are real changes before updating manifest
await gitAdapter.git!.add(".");
const preStatus = await gitAdapter.git!.status();
const hasRealChanges = !preStatus.isClean();

// 11. Update manifest only if there are real changes
const registry = new MachineRegistry(join(storePath, "manifest.json"));
await registry.conditionalRegister(
  config.machineId, hostname(), platform(), hasRealChanges,
);

// 12. Commit and push (with branch support)
const result = await gitAdapter.commitAndPush(
  `sync: push from ${config.machineId}`,
  config.machineId,
);
```

- [ ] **Step 4: Run push tests**

Run: `npx vitest run tests/commands/push.test.ts`
Expected: All PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/commands/push.ts tests/commands/push.test.ts
git commit -m "refactor: replace nuke-and-rebuild with incremental push using staging dir"
```

---

## Chunk 3: Pull Improvements

### Task 8: Rewrite PullCommand — Temp Dir Decrypt, No Re-encrypt

**Files:**
- Modify: `src/commands/pull.ts`
- Modify: `tests/commands/pull.test.ts`

- [ ] **Step 1: Write/update failing tests**

Add to `tests/commands/pull.test.ts`:

```typescript
describe("pull improvements", () => {
  it("does not modify the store during pull (no re-encrypt commit)", async () => {
    // Push encrypted content
    await pushCmd.execute(pushOptions);
    const git = simpleGit(storePath);
    const logBefore = await git.log();

    // Pull should not create a commit
    await pullCmd.execute(pullOptions);
    const logAfter = await git.log();

    // No new commits from pull (store untouched)
    expect(logAfter.total).toBe(logBefore.total);
  });

  it("preserves non-claudefy hooks from remote settings", async () => {
    // Set up remote settings.json with both claudefy and custom hooks
    const settings = {
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "claudefy pull --quiet" }] },
          { hooks: [{ type: "command", command: "my-custom-script.sh" }] },
        ],
      },
    };
    await writeFile(
      join(storePath, "config", "settings.json"),
      JSON.stringify(settings),
    );

    await pullCmd.execute(pullOptions);

    const localSettings = JSON.parse(
      await readFile(join(claudeDir, "settings.json"), "utf-8"),
    );
    // Custom hooks preserved, claudefy hooks stripped
    const startHooks = localSettings.hooks?.SessionStart ?? [];
    expect(startHooks).toHaveLength(1);
    expect(startHooks[0].hooks[0].command).toBe("my-custom-script.sh");
  });

  it("uses machine branch and merges from main", async () => {
    // Verify pull calls pullAndMergeMain and operates on machine branch
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands/pull.test.ts`
Expected: FAIL

- [ ] **Step 3: Rewrite pull.ts**

Key changes:
- Use `gitAdapter.ensureMachineBranch()` + `pullAndMergeMain()` instead of `pull()`
- Decrypt into temp working directory instead of modifying store in-place
- Remove the re-encryption step entirely (lines 230-241 deleted)
- Remove the `commitAndPush` at the end of pull (line 246 deleted)
- Fix hook stripping: only remove claudefy-managed hooks, preserve user hooks

```typescript
// Key structural changes to pull.ts execute():

// 1. Initialize git adapter with branch support
const gitAdapter = new GitAdapter(claudefyDir);
await gitAdapter.initStore(config.backend.url);
await gitAdapter.ensureMachineBranch(config.machineId);
await gitAdapter.pullAndMergeMain();

const storePath = gitAdapter.getStorePath();

// 2-3. Check override, create backup (same as before)

// 4. Create temp working directory for decryption
const tmpDir = join(claudefyDir, ".pull-tmp");
if (existsSync(tmpDir)) await rm(tmpDir, { recursive: true });
await mkdir(tmpDir, { recursive: true });

try {
  // 5. Copy store config/unknown to temp dir
  const storeConfigDir = join(storePath, "config");
  const storeUnknownDir = join(storePath, "unknown");
  const tmpConfigDir = join(tmpDir, "config");
  const tmpUnknownDir = join(tmpDir, "unknown");

  if (existsSync(storeConfigDir)) {
    await cp(storeConfigDir, tmpConfigDir, { recursive: true });
  }
  if (existsSync(storeUnknownDir)) {
    await cp(storeUnknownDir, tmpUnknownDir, { recursive: true });
  }

  // 6. Decrypt .age files in temp dir (not in store)
  if (encryptedFiles.length > 0) {
    const encryptor = new Encryptor(options.passphrase!);
    if (existsSync(tmpConfigDir)) await encryptor.decryptDirectory(tmpConfigDir);
    if (existsSync(tmpUnknownDir)) await encryptor.decryptDirectory(tmpUnknownDir);
  }

  // 7. Remap paths in temp dir (same logic, different base dir)
  // ... path remapping targeting tmpConfigDir ...

  // 8. Fix hook stripping: preserve non-claudefy hooks
  if (existsSync(tmpSettingsPath)) {
    const remoteSettings = JSON.parse(await readFile(tmpSettingsPath, "utf-8"));
    if (remoteSettings.hooks) {
      // Strip only claudefy-managed hooks, keep user hooks
      for (const event of Object.keys(remoteSettings.hooks)) {
        if (!Array.isArray(remoteSettings.hooks[event])) continue;
        remoteSettings.hooks[event] = remoteSettings.hooks[event].filter(
          (h: HookEventConfig) => !isClaudefyHook(h),
        );
        if (remoteSettings.hooks[event].length === 0) {
          delete remoteSettings.hooks[event];
        }
      }
      if (Object.keys(remoteSettings.hooks).length === 0) {
        delete remoteSettings.hooks;
      }
    }
    // ... merge with local settings ...
  }

  // 9. Copy from temp dir to ~/.claude (same as before)
  // ... copy logic ...

} finally {
  // 10. Clean up temp dir
  if (existsSync(tmpDir)) await rm(tmpDir, { recursive: true });
}

// NO re-encryption step
// NO commitAndPush at end of pull
```

Helper function for hook filtering:

```typescript
function isClaudefyHook(hookEntry: { hooks?: Array<{ command?: string }> }): boolean {
  if (!Array.isArray(hookEntry.hooks)) return false;
  return hookEntry.hooks.some((h) => {
    const command = typeof h.command === "string" ? h.command.trim() : "";
    return command.startsWith("claudefy pull") || command.startsWith("claudefy push");
  });
}
```

- [ ] **Step 4: Run pull tests**

Run: `npx vitest run tests/commands/pull.test.ts`
Expected: All PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/commands/pull.ts tests/commands/pull.test.ts
git commit -m "refactor: pull decrypts in temp dir, no re-encrypt, preserve user hooks"
```

---

## Chunk 4: Command Fixes and Override Update

### Task 9: Fix JoinCommand — Register After Pull

**Files:**
- Modify: `src/commands/join.ts`
- Modify: `tests/commands/join.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/commands/join.test.ts`:

```typescript
it("registers machine after successful pull, not before", async () => {
  // Mock pull to fail
  // Verify machine is NOT in manifest after failed join
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands/join.test.ts`
Expected: FAIL

- [ ] **Step 3: Fix join.ts**

Move the `registry.register()` call to after the `pull.execute()` call. Read the current file to find exact lines.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/commands/join.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/join.ts tests/commands/join.test.ts
git commit -m "fix: register machine after successful pull in JoinCommand"
```

---

### Task 10: Update OverrideCommand for Branches

**Files:**
- Modify: `src/commands/override.ts`
- Modify: `tests/commands/override.test.ts`

- [ ] **Step 1: Update override.ts**

The override command needs to:
1. Ensure machine branch exists
2. Wipe and push (which now force-updates main to match machine branch)

Read current `src/commands/override.ts` and update to use `ensureMachineBranch()` before calling `wipeAndPush()`.

- [ ] **Step 2: Update override tests**

Verify that override force-updates main and pushes the override marker.

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/commands/override.test.ts`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/commands/override.ts tests/commands/override.test.ts
git commit -m "feat: update override to use per-machine branch strategy"
```

---

### Task 11: Update Init and Join for Branch Support

**Files:**
- Modify: `src/commands/init.ts`
- Modify: `src/commands/join.ts`

- [ ] **Step 1: Update init.ts**

After `gitAdapter.initStore()`, add `gitAdapter.ensureMachineBranch(config.machineId)` before running the push pipeline.

- [ ] **Step 2: Update join.ts**

After `gitAdapter.initStore()`, add `gitAdapter.ensureMachineBranch(config.machineId)` and use `pullAndMergeMain()`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/commands/init.test.ts tests/commands/join.test.ts`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/commands/init.ts src/commands/join.ts
git commit -m "feat: init and join use per-machine branches"
```

---

## Chunk 5: Integration Tests and Documentation

### Task 12: Update Integration Tests

**Files:**
- Modify: `tests/integration/full-sync.test.ts`

- [ ] **Step 1: Update full-sync integration test**

The integration test simulates two machines syncing. Update to verify:
- Each machine operates on its own branch
- Push from machine A creates `machines/machine-a` branch and merges to main
- Pull on machine B fetches main and merges into `machines/machine-b`
- No spurious commits when nothing changed (second push is no-op)
- Override from machine A force-updates main
- Encrypted `.jsonl` files produce deterministic ciphertext

- [ ] **Step 2: Run integration tests**

Run: `npx vitest run tests/integration/`
Expected: All PASS

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/integration/full-sync.test.ts
git commit -m "test: update integration tests for branch-based incremental sync"
```

---

### Task 13: Documentation Updates

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read current README.md**

Read the full README to understand existing structure.

- [ ] **Step 2: Add architecture section**

Add after the existing introduction/usage section:

```markdown
## Architecture

### Per-Machine Branches

Each machine syncs to its own git branch (`machines/<machineId>`). The `main` branch holds the merged state from all machines.

- **Push (SessionEnd):** Commits to your machine branch, merges into `main`, pushes both
- **Pull (SessionStart):** Fetches `main`, merges into your machine branch, applies to `~/.claude`
- **Override:** Force-updates `main` to match your machine — use when you've found your ideal setup

This prevents conflicts between machines. Each machine's changes are isolated on its branch, and merging happens automatically.

### Encryption

Files containing detected secrets are encrypted using AES-256-SIV (deterministic authenticated encryption):

- **Session transcripts (`.jsonl`):** Encrypted per-line — each line is independently encrypted, so git can diff and merge encrypted files just like plaintext
- **Other files:** Encrypted as a whole — produces identical ciphertext for identical content, so unchanged files produce no git diff

Deterministic encryption means re-pushing the same content produces identical output. Only files that actually changed show up in commits.

### What Gets Synced

| Category | Items | Notes |
|----------|-------|-------|
| **Synced** | commands, agents, skills, hooks, rules, plans, plugins, agent-memory, projects, settings.json, history.jsonl, package.json | Full plugin cache included |
| **Never synced** | cache, backups, file-history, shell-snapshots, paste-cache, session-env, tasks, .credentials.json | Machine-specific or sensitive |
| **Unknown** | Anything not in either list | Encrypted by default |

### Security Model

- `.credentials.json` is **never synced** — re-authenticate on each machine or use a credential manager
- Hooks from remote settings are stripped on pull to prevent remote code injection — only non-claudefy hooks from remote are preserved
- Secret scanner detects common patterns (API keys, tokens) but cannot catch all secrets — avoid pasting credentials in prompts when possible
- Files with detected secrets are encrypted before commit; plaintext is never pushed to git
```

- [ ] **Step 3: Add multi-machine workflow section**

```markdown
## Multi-Machine Workflow

### First machine setup
\`\`\`bash
claudefy init --backend https://github.com/you/claude-sync.git --hooks
\`\`\`

### Additional machines
\`\`\`bash
claudefy join --backend https://github.com/you/claude-sync.git --hooks
\`\`\`

### Daily workflow
With hooks installed, sync is automatic:
- **Start a Claude session:** Your machine pulls the latest config from all other machines
- **End a Claude session:** Your changes are pushed to your machine branch and merged into main

### Override: Set the canonical config
When you've found your ideal setup on one machine:
\`\`\`bash
claudefy override --confirm
\`\`\`
This force-updates the remote to match your current machine exactly. Other machines will receive this override on their next session start.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add architecture, encryption, multi-machine workflow, security model"
```

---

### Task 14: Clean Up

**Files:**
- Modify: `package.json`
- Delete: `benchmarks/per-line-encryption.ts` (optional — can keep for reference)

- [ ] **Step 1: Verify age-encryption is fully removed**

```bash
grep -r "age-encryption" src/ tests/
```

Expected: No matches

- [ ] **Step 2: Verify @noble/ciphers and @noble/hashes are in dependencies**

Check `package.json` has both packages in `dependencies` (not `devDependencies`).

- [ ] **Step 3: Run full test suite one final time**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Final commit**

```bash
git add package.json
git commit -m "chore: clean up dependencies — remove age-encryption"
```
