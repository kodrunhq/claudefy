import { env } from "node:process";
import { createInterface } from "node:readline";
import { Entry } from "@napi-rs/keyring";

const KEYRING_SERVICE = "claudefy";
const KEYRING_ACCOUNT = "passphrase";

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
      const entry = new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
      const stored = entry.getPassword();
      if (stored) {
        return { passphrase: stored, source: "keychain" };
      }
    } catch {
      // Keyring not available (headless, no D-Bus, etc.), fall through
    }
  }

  return null;
}

export function storePassphraseInKeychain(passphrase: string): boolean {
  try {
    const entry = new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
    entry.setPassword(passphrase);
    return true;
  } catch {
    return false;
  }
}

export function isKeychainAvailable(): boolean {
  try {
    const entry = new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
    // Try a read — if the backend is unavailable this throws
    entry.getPassword();
    return true;
  } catch {
    return false;
  }
}

export function prompt(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (hidden && process.stdin.isTTY) {
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]): boolean => {
        if (typeof chunk === "string" && chunk.includes(question)) {
          return origWrite(chunk, ...(args as [BufferEncoding, (err?: Error | null) => void]));
        }
        return true;
      }) as typeof process.stdout.write;

      rl.question(question, (answer) => {
        process.stdout.write = origWrite;
        console.log();
        rl.close();
        resolve(answer);
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

function promptYesNo(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  return prompt(`${question} ${hint} `).then((answer) => {
    if (!answer.trim()) return defaultYes;
    return answer.trim().toLowerCase().startsWith("y");
  });
}

export interface PassphraseSetupResult {
  passphrase: string;
  storedInKeychain: boolean;
}

async function offerKeychainStorage(passphrase: string): Promise<boolean> {
  if (isKeychainAvailable()) {
    const storeIt = await promptYesNo("Store passphrase in OS keychain?");
    if (storeIt) {
      return storePassphraseInKeychain(passphrase);
    }
  }
  return false;
}

function printKeychainHint(storedInKeychain: boolean): void {
  if (!storedInKeychain) {
    console.log(
      "Set CLAUDEFY_PASSPHRASE environment variable in your shell profile to avoid re-entering.",
    );
  }
}

export async function promptExistingPassphrase(): Promise<PassphraseSetupResult | null> {
  const passphrase = await prompt("Enter encryption passphrase: ", true);
  if (!passphrase.trim()) {
    return null;
  }

  const storedInKeychain = await offerKeychainStorage(passphrase);
  printKeychainHint(storedInKeychain);
  return { passphrase, storedInKeychain };
}

export async function promptPassphraseSetup(): Promise<PassphraseSetupResult | null> {
  const wantsEncryption = await promptYesNo("Enable encryption for synced data?");
  if (!wantsEncryption) {
    return null;
  }

  let passphrase: string;
  while (true) {
    const entered = await prompt("Enter encryption passphrase: ", true);
    if (!entered.trim()) {
      console.log("Passphrase cannot be empty. Please try again.");
      continue;
    }

    const confirm = await prompt("Confirm passphrase: ", true);
    if (entered !== confirm) {
      console.log("Passphrases do not match. Please try again.");
      continue;
    }

    passphrase = entered;
    break;
  }

  const storedInKeychain = await offerKeychainStorage(passphrase);
  printKeychainHint(storedInKeychain);
  return { passphrase, storedInKeychain };
}
