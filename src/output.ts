import chalk from "chalk";

export const output = {
  success: (msg: string) => console.log(chalk.green("\u2714") + " " + msg),
  info: (msg: string) => console.log(chalk.blue("\u2139") + " " + msg),
  warn: (msg: string) => console.error(chalk.yellow("\u26A0") + " " + msg),
  error: (msg: string) => console.error(chalk.red("\u2716") + " " + msg),
  dim: (msg: string) => console.log(chalk.dim(msg)),
  heading: (msg: string) => console.log(chalk.bold.underline(msg)),
};

/**
 * Redacts credentials from a URL before displaying it to the user.
 * Replaces userinfo (user:password@) with [redacted]@ for HTTPS URLs.
 * SSH git URLs (git@host:path) are returned as-is since they don't embed secrets.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
    // Only redact when a password is present, or for HTTP(S) URLs with any userinfo.
    // SSH URLs (ssh://git@host) have non-secret usernames — leave them as-is.
    if (parsed.password || (isHttp && parsed.username)) {
      parsed.username = parsed.username ? "[redacted]" : "";
      parsed.password = "";
      return parsed.toString();
    }
    return url;
  } catch {
    // Not a standard URL (e.g. SSH git remote shorthand) — return as-is
    return url;
  }
}
