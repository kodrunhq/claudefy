import { describe, it, expect, afterEach, vi } from "vitest";

// Mock @napi-rs/keyring before importing the module under test
const mockGetPassword = vi.fn();
const mockSetPassword = vi.fn();

vi.mock("@napi-rs/keyring", () => {
  return {
    Entry: class MockEntry {
      getPassword() {
        return mockGetPassword();
      }
      setPassword(pass: string) {
        return mockSetPassword(pass);
      }
    },
  };
});

import {
  resolvePassphrase,
  storePassphraseInKeychain,
  isKeychainAvailable,
} from "../../src/encryptor/passphrase.js";

describe("resolvePassphrase", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mockGetPassword.mockReset();
  });

  it("returns passphrase from env var", async () => {
    vi.stubEnv("CLAUDEFY_PASSPHRASE", "test-pass");

    const result = await resolvePassphrase(false);
    expect(result).not.toBeNull();
    expect(result!.passphrase).toBe("test-pass");
    expect(result!.source).toBe("env");
  });

  it("returns null when env var is empty", async () => {
    vi.stubEnv("CLAUDEFY_PASSPHRASE", "");

    const result = await resolvePassphrase(false);
    expect(result).toBeNull();
  });

  it("returns null when useKeychain is false and env var is unset", async () => {
    delete process.env.CLAUDEFY_PASSPHRASE;

    const result = await resolvePassphrase(false);
    expect(result).toBeNull();
  });

  it("returns passphrase from keychain when useKeychain is true", async () => {
    delete process.env.CLAUDEFY_PASSPHRASE;
    mockGetPassword.mockReturnValue("keychain-pass");

    const result = await resolvePassphrase(true);
    expect(result).not.toBeNull();
    expect(result!.passphrase).toBe("keychain-pass");
    expect(result!.source).toBe("keychain");
  });

  it("prefers env var over keychain", async () => {
    vi.stubEnv("CLAUDEFY_PASSPHRASE", "env-pass");
    mockGetPassword.mockReturnValue("keychain-pass");

    const result = await resolvePassphrase(true);
    expect(result!.passphrase).toBe("env-pass");
    expect(result!.source).toBe("env");
  });

  it("returns null when keychain has no stored password", async () => {
    delete process.env.CLAUDEFY_PASSPHRASE;
    mockGetPassword.mockReturnValue(null);

    const result = await resolvePassphrase(true);
    expect(result).toBeNull();
  });

  it("returns null when keychain throws (headless)", async () => {
    delete process.env.CLAUDEFY_PASSPHRASE;
    mockGetPassword.mockImplementation(() => {
      throw new Error("D-Bus not available");
    });

    const result = await resolvePassphrase(true);
    expect(result).toBeNull();
  });
});

describe("storePassphraseInKeychain", () => {
  afterEach(() => {
    mockSetPassword.mockReset();
  });

  it("stores passphrase and returns true", async () => {
    mockSetPassword.mockReturnValue(undefined);
    expect(await storePassphraseInKeychain("my-pass")).toBe(true);
    expect(mockSetPassword).toHaveBeenCalledWith("my-pass");
  });

  it("returns false when keychain throws", async () => {
    mockSetPassword.mockImplementation(() => {
      throw new Error("no keychain");
    });
    expect(await storePassphraseInKeychain("my-pass")).toBe(false);
  });
});

describe("isKeychainAvailable", () => {
  afterEach(() => {
    mockGetPassword.mockReset();
  });

  it("returns true when keychain is accessible", async () => {
    mockGetPassword.mockReturnValue(null);
    expect(await isKeychainAvailable()).toBe(true);
  });

  it("returns false when keychain throws", async () => {
    mockGetPassword.mockImplementation(() => {
      throw new Error("no D-Bus");
    });
    expect(await isKeychainAvailable()).toBe(false);
  });
});
