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
];

export class SecretScanner {
  async scanFile(filePath: string): Promise<SecretFinding[]> {
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
