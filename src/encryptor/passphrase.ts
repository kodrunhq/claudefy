import { env } from "node:process";
import { createRequire } from "node:module";

export type PassphraseSource = "env" | "keychain" | "prompt" | "none";

export interface PassphraseResult {
  passphrase: string;
  source: PassphraseSource;
}

export async function resolvePassphrase(useKeychain: boolean): Promise<PassphraseResult | null> {
  const envPassphrase = env.CLAUDEFY_PASSPHRASE;
  if (envPassphrase) {
    return { passphrase: envPassphrase, source: "env" };
  }

  if (useKeychain) {
    try {
      const require = createRequire(import.meta.url);
      const keytar = require("keytar");
      const stored = await keytar.getPassword("claudefy", "passphrase");
      if (stored) {
        return { passphrase: stored, source: "keychain" };
      }
    } catch {
      // keytar not available, fall through
    }
  }

  return null;
}

export async function storePassphraseInKeychain(passphrase: string): Promise<boolean> {
  try {
    const require = createRequire(import.meta.url);
    const keytar = require("keytar");
    await keytar.setPassword("claudefy", "passphrase", passphrase);
    return true;
  } catch {
    return false;
  }
}
