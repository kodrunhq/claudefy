import { readFile } from "node:fs/promises";

export interface SecretFinding {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
}

const SECRET_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "Anthropic API Key", regex: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { name: "OpenAI API Key", regex: /sk-[a-zA-Z0-9]{20,}/ },
  { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/ },
  { name: "GitHub Token", regex: /ghp_[A-Za-z0-9]{36}/ },
  { name: "GitHub OAuth", regex: /gho_[A-Za-z0-9]{36}/ },
  { name: "GitLab Token", regex: /glpat-[A-Za-z0-9\-_]{20,}/ },
  { name: "Generic Bearer", regex: /Bearer\s+[a-zA-Z0-9_\-.]{20,}/ },
  { name: "Generic Secret Key", regex: /"(?:secret|password|token|apiKey|api_key|private_key)"\s*:\s*"[^"]{8,}"/ },
  { name: "High Entropy Base64", regex: /[A-Za-z0-9+/]{40,}={0,2}/ },
];

export class SecretScanner {
  async scanFile(filePath: string): Promise<SecretFinding[]> {
    const content = await readFile(filePath, "utf-8");
    const findings: SecretFinding[] = [];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.regex.test(lines[i])) {
          findings.push({
            file: filePath,
            line: i + 1,
            pattern: pattern.name,
            snippet: lines[i].slice(0, 80),
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
