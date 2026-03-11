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

export function isNewer(latest: string, current: string): boolean {
  const parseSegment = (s: string) => parseInt(s, 10) || 0;
  const l = latest.split(".").map(parseSegment);
  const c = current.split(".").map(parseSegment);
  for (let i = 0; i < 3; i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
}

export async function checkForUpdates(currentVersion: string, claudefyDir: string): Promise<void> {
  try {
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
    timeout.unref();
    let res: Response;
    try {
      res = await fetch(REGISTRY_URL, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

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
