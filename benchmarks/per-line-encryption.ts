/**
 * Benchmark: per-line deterministic encryption with AES-256-SIV.
 *
 * Tests with realistic .jsonl session files at various sizes.
 * Run: npx tsx benchmarks/per-line-encryption.ts
 */
import { aessiv } from "@noble/ciphers/aes.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

// --- Deterministic per-line encryption using AES-256-SIV ---

function deriveKey(passphrase: string, salt: string): Uint8Array {
  return hmac(sha256, new TextEncoder().encode(passphrase), new TextEncoder().encode(salt));
}

function encryptLine(line: string, key: Uint8Array): string {
  const cipher = aessiv(key, new Uint8Array(0));
  const plaintext = new TextEncoder().encode(line);
  const encrypted = cipher.encrypt(plaintext);
  return Buffer.from(encrypted).toString("base64");
}

function decryptLine(encoded: string, key: Uint8Array): string {
  const cipher = aessiv(key, new Uint8Array(0));
  const encrypted = new Uint8Array(Buffer.from(encoded, "base64"));
  const decrypted = cipher.decrypt(encrypted);
  return new TextDecoder().decode(decrypted);
}

function encryptLines(lines: string[], key: Uint8Array): string[] {
  return lines.map((line) => encryptLine(line, key));
}

function decryptLines(encrypted: string[], key: Uint8Array): string[] {
  return encrypted.map((line) => decryptLine(line, key));
}

// --- Generate realistic session data ---

function generateSessionLine(index: number): string {
  const roles = ["user", "assistant"];
  const role = roles[index % 2];

  if (role === "user") {
    return JSON.stringify({
      role: "user",
      content: `Can you help me refactor the ${["authentication", "database", "API", "caching", "logging"][index % 5]} module? I want to ${["add tests", "improve performance", "fix the bug in", "add error handling to", "simplify"][index % 5]} the ${["UserService", "DataStore", "ApiClient", "CacheManager", "Logger"][index % 5]} class. Here's the current code that needs work on line ${index}.`,
      timestamp: new Date().toISOString(),
    });
  }

  const codeBlock = `function example${index}() {\n  const data = await fetch('/api/endpoint');\n  if (!data.ok) throw new Error('Failed');\n  return data.json();\n}`;
  return JSON.stringify({
    role: "assistant",
    content: `Here's the refactored version:\n\n\`\`\`typescript\n${codeBlock}\n\`\`\`\n\nKey changes:\n1. Added proper error handling\n2. Used async/await pattern\n3. Added type safety with generics\n4. Extracted the validation logic into a separate method for better testability and reuse across the codebase. This ensures we maintain the single responsibility principle while keeping the code readable and maintainable for future developers who might need to modify this behavior.`,
    timestamp: new Date().toISOString(),
  });
}

function generateSession(lineCount: number): string[] {
  return Array.from({ length: lineCount }, (_, i) => generateSessionLine(i));
}

// --- Benchmark runner ---

async function benchmarkPerLine(lines: string[], key: Uint8Array) {
  const start = performance.now();
  const encrypted = encryptLines(lines, key);
  const encryptTime = performance.now() - start;

  const start2 = performance.now();
  const decrypted = decryptLines(encrypted, key);
  const decryptTime = performance.now() - start2;

  // Verify correctness
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== decrypted[i]) {
      throw new Error(`Line ${i} mismatch after decrypt`);
    }
  }

  // Verify determinism: encrypting again should produce identical output
  const encrypted2 = encryptLines(lines, key);
  for (let i = 0; i < encrypted.length; i++) {
    if (encrypted[i] !== encrypted2[i]) {
      throw new Error(`Line ${i} not deterministic!`);
    }
  }

  const encryptedSize = encrypted.join("\n").length;
  const plaintextSize = lines.join("\n").length;

  return { encryptTime, decryptTime, encryptedSize, plaintextSize };
}

// --- Incremental diff simulation ---

function simulateIncrementalPush(
  previousEncrypted: string[],
  currentLines: string[],
  key: Uint8Array,
): { changedLines: number; totalLines: number; encryptTime: number } {
  const start = performance.now();
  const newEncrypted: string[] = [];
  let changedLines = 0;

  for (let i = 0; i < currentLines.length; i++) {
    const encrypted = encryptLine(currentLines[i], key);
    if (i >= previousEncrypted.length || encrypted !== previousEncrypted[i]) {
      changedLines++;
    }
    newEncrypted.push(encrypted);
  }

  const encryptTime = performance.now() - start;
  return { changedLines, totalLines: currentLines.length, encryptTime };
}

// --- Main ---

async function main() {
  const passphrase = "benchmark-test-passphrase-2024";
  const key = deriveKey(passphrase, "claudefy-line-encryption-v1");

  console.log("=== Per-line Deterministic Encryption Benchmark ===\n");

  const sizes = [50, 200, 500, 1000, 3000];

  for (const size of sizes) {
    const lines = generateSession(size);
    const plaintextBytes = lines.join("\n").length;

    console.log(`--- ${size} lines (${(plaintextBytes / 1024).toFixed(1)} KB plaintext) ---`);

    const sivResult = await benchmarkPerLine(lines, key);
    console.log(`  AES-SIV per-line:`);
    console.log(`    Encrypt: ${sivResult.encryptTime.toFixed(1)}ms`);
    console.log(`    Decrypt: ${sivResult.decryptTime.toFixed(1)}ms`);
    console.log(
      `    Size:    ${(sivResult.encryptedSize / 1024).toFixed(1)} KB (${((sivResult.encryptedSize / sivResult.plaintextSize) * 100).toFixed(0)}% of plaintext)`,
    );
    console.log(`    Deterministic: YES`);

    // Incremental push simulation (append 10 new lines to existing session)
    const previousLines = lines.slice(0, -10);
    const previousEncrypted = encryptLines(previousLines, key);
    const incrementalResult = simulateIncrementalPush(previousEncrypted, lines, key);
    console.log(`  Incremental push (10 new lines appended):`);
    console.log(`    Encrypt: ${incrementalResult.encryptTime.toFixed(1)}ms`);
    console.log(
      `    Git diff: ${incrementalResult.changedLines}/${incrementalResult.totalLines} lines changed`,
    );

    console.log();
  }

  // Determinism proof: encrypt same content twice, show git would see no diff
  console.log("=== Determinism Proof ===");
  const testLines = generateSession(100);
  const enc1 = encryptLines(testLines, key);
  const enc2 = encryptLines(testLines, key);
  const allMatch = enc1.every((line, i) => line === enc2[i]);
  console.log(
    `  100 lines encrypted twice: ${allMatch ? "IDENTICAL (git sees no diff)" : "DIFFERENT (git sees changes)"}`,
  );
}

main().catch(console.error);
