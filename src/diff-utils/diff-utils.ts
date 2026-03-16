import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";

export interface DiffResult {
  added: string[]; // present in source, not in target
  deleted: string[]; // present in target, not in source
  modified: string[]; // present in both, content differs
  hasChanges: boolean;
}

async function hashFile(path: string): Promise<string> {
  const content = await readFile(path);
  return createHash("sha256").update(content).digest("hex");
}

async function collectFiles(dir: string, prefix = ""): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!existsSync(dir)) return result;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) continue; // Skip symlinks to avoid path traversal
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await collectFiles(fullPath, relPath);
      for (const [k, v] of sub) result.set(k, v);
    } else {
      result.set(relPath, await hashFile(fullPath));
    }
  }
  return result;
}

export async function computeDiff(sourceDir: string, targetDir: string): Promise<DiffResult> {
  const sourceFiles = await collectFiles(sourceDir);
  const targetFiles = await collectFiles(targetDir);

  const added: string[] = [];
  const deleted: string[] = [];
  const modified: string[] = [];

  for (const [name, hash] of sourceFiles) {
    if (!targetFiles.has(name)) {
      added.push(name);
    } else if (targetFiles.get(name) !== hash) {
      modified.push(name);
    }
  }
  for (const name of targetFiles.keys()) {
    if (!sourceFiles.has(name)) {
      deleted.push(name);
    }
  }

  return {
    added: added.sort(),
    deleted: deleted.sort(),
    modified: modified.sort(),
    hasChanges: added.length > 0 || deleted.length > 0 || modified.length > 0,
  };
}
