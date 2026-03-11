import { describe, it, expect } from "vitest";
import { normalizeRepoUrl } from "../../src/encryptor/key-derivation.js";

describe("normalizeRepoUrl", () => {
  it("normalizes HTTPS URL", () => {
    expect(normalizeRepoUrl("https://github.com/user/repo")).toBe("github.com/user/repo");
  });

  it("normalizes HTTPS URL with trailing .git", () => {
    expect(normalizeRepoUrl("https://github.com/user/repo.git")).toBe("github.com/user/repo");
  });

  it("normalizes SSH shorthand", () => {
    expect(normalizeRepoUrl("git@github.com:user/repo.git")).toBe("github.com/user/repo");
  });

  it("normalizes SSH shorthand without .git", () => {
    expect(normalizeRepoUrl("git@github.com:user/repo")).toBe("github.com/user/repo");
  });

  it("normalizes ssh:// protocol URL", () => {
    expect(normalizeRepoUrl("ssh://git@github.com/user/repo.git")).toBe("github.com/user/repo");
  });

  it("lowercases the host but preserves path case", () => {
    expect(normalizeRepoUrl("https://GitHub.COM/User/Repo")).toBe("github.com/User/Repo");
  });

  it("strips trailing slashes", () => {
    expect(normalizeRepoUrl("https://github.com/user/repo/")).toBe("github.com/user/repo");
  });

  it("handles HTTPS with userinfo", () => {
    expect(normalizeRepoUrl("https://token@github.com/user/repo.git")).toBe("github.com/user/repo");
  });

  it("produces same output for equivalent SSH and HTTPS URLs", () => {
    const ssh = normalizeRepoUrl("git@github.com:kodrunhq/claudefy.git");
    const https = normalizeRepoUrl("https://github.com/kodrunhq/claudefy");
    expect(ssh).toBe(https);
  });

  it("handles bare path (local filesystem)", () => {
    expect(normalizeRepoUrl("/tmp/my-repo.git")).toBe("/tmp/my-repo");
  });

  it("trims whitespace", () => {
    expect(normalizeRepoUrl("  https://github.com/user/repo  ")).toBe("github.com/user/repo");
  });
});
