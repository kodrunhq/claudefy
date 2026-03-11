import { readFile } from "node:fs/promises";

export interface SecretFinding {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
}

const SECRET_PATTERNS: { name: string; regex: RegExp }[] = [
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
  { name: "Twilio API Key", regex: /SK[0-9a-fA-F]{32}/ },
  { name: "Datadog API Key", regex: /dd[a-z]{0,2}_[0-9a-zA-Z]{32,}/ },
];

export class SecretScanner {
  async scanFile(filePath: string): Promise<SecretFinding[]> {
    // Skip encrypted files — they're binary blobs, not plaintext secrets
    if (filePath.endsWith(".age")) return [];

    const content = await readFile(filePath, "utf-8");
    const findings: SecretFinding[] = [];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      for (const pattern of SECRET_PATTERNS) {
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
