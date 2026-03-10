import { describe, it, expect, afterEach, vi } from "vitest";
import { resolvePassphrase } from "../../src/encryptor/passphrase.js";

describe("resolvePassphrase", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
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

  it("returns null when useKeychain is false and no env", async () => {
    vi.stubEnv("CLAUDEFY_PASSPHRASE", "");

    const result = await resolvePassphrase(false);
    expect(result).toBeNull();
  });
});
