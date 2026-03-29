import { readFile } from "node:fs/promises";

export interface SecretFinding {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
}

export interface CustomPattern {
  name: string;
  regex: string;
  flags?: string;
}

interface SecretPattern {
  name: string;
  regex: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { name: "Anthropic API Key", regex: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { name: "OpenAI API Key", regex: /sk-(?!ant-)[a-zA-Z0-9]{20,}/ },
  { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/ },
  { name: "GitHub Token", regex: /ghp_[A-Za-z0-9]{36}/ },
  { name: "GitHub OAuth", regex: /gho_[A-Za-z0-9]{36}/ },
  { name: "GitLab Token", regex: /glpat-[A-Za-z0-9\-_]{20,}/ },
  {
    name: "Generic Secret Key",
    regex: /"(?:secret|password|token|apiKey|api_key|private_key)"\s*:\s*"[^"]{8,}"/,
  },
  { name: "Google API Key", regex: /AIza[0-9A-Za-z\-_]{35}/ },
  { name: "Slack Bot Token", regex: /xoxb-[0-9A-Za-z-]{50,}/ },
  { name: "Slack User Token", regex: /xoxp-[0-9A-Za-z-]{50,}/ },
  { name: "Stripe Live Key", regex: /sk_live_[0-9a-zA-Z]{24,}/ },
  { name: "Stripe Test Key", regex: /sk_test_[0-9a-zA-Z]{24,}/ },
  { name: "Azure Connection String", regex: /AccountKey=[A-Za-z0-9+/=]{44,}/ },
  { name: "Twilio API Key", regex: /\bSK[0-9a-fA-F]{32}\b/ },
  { name: "Datadog API Key", regex: /\b(?:ddapi|ddog|dd)_[0-9a-zA-Z]{32,}\b/ },
  // env / shell / YAML / JS formats
  {
    name: "Env-style Secret",
    regex:
      /^(?:export\s+)?[A-Z_]{3,}(?:SECRET|PASSWORD|TOKEN|API_KEY|APIKEY|PRIVATE_KEY)\s*=\s*.{8,}/m,
  },
  {
    name: "YAML Secret",
    regex: /^[ \t]*(?:secret|password|api_key|apiKey|private_key)\s*:\s*['"]?[^'"\s]{8,}/m,
  },
  {
    name: "JS/TS Secret Assignment",
    regex:
      /(?:const|let|var)\s+(?:secret|password|token|apiKey|api_key|privateKey)\s*=\s*['"`][^'"`]{8,}/,
  },
];

export class SecretScanner {
  private readonly patterns: SecretPattern[];

  constructor(customPatterns?: CustomPattern[]) {
    const custom = (customPatterns ?? []).map((p) => {
      try {
        return { name: p.name, regex: new RegExp(p.regex, p.flags) };
      } catch (e) {
        throw new Error(`Invalid regex in custom pattern "${p.name}": ${(e as Error).message}`, {
          cause: e,
        });
      }
    });
    this.patterns = [...SECRET_PATTERNS, ...custom];
  }

  async scanFile(filePath: string): Promise<SecretFinding[]> {
    // Skip encrypted files — they're binary blobs, not plaintext secrets
    if (filePath.endsWith(".age")) return [];

    // Read as buffer first to detect binary content
    const buf = await readFile(filePath);
    if (buf.includes(0)) return []; // null bytes indicate binary file

    const content = buf.toString("utf-8");
    const findings: SecretFinding[] = [];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      for (const pattern of this.patterns) {
        const match = pattern.regex.exec(lines[i]);
        if (match) {
          // Redact matched secret, showing only prefix and suffix
          const matched = match[0];
          const redacted =
            matched.length > 8 ? matched.slice(0, 4) + "****" + matched.slice(-4) : "****";
          findings.push({
            file: filePath,
            line: i + 1,
            pattern: pattern.name,
            snippet: lines[i].slice(0, 80).replace(matched, redacted),
          });
        }
      }
    }

    return findings;
  }

  async scanFiles(filePaths: string[]): Promise<SecretFinding[]> {
    const results: SecretFinding[] = [];
    for (const filePath of filePaths) {
      const findings = await this.scanFile(filePath);
      results.push(...findings);
    }
    return results;
  }
}
