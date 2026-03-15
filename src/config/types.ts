export interface ClaudefyConfig {
  version: number;
  backend: {
    type: "git";
    url: string;
  };
  encryption: {
    enabled: boolean;
    useKeychain: boolean;
    cacheDuration: string;
    mode?: "reactive" | "full";
  };
  machineId: string;
  secretScanner?: {
    customPatterns: Array<{ name: string; regex: string; flags?: string }>;
  };
  backups?: {
    maxCount: number;
    maxAgeDays: number;
  };
  claudeJson?: {
    sync: boolean;
    syncMcpServers: boolean;
  };
}

export interface LinksConfig {
  [alias: string]: {
    localPath: string;
    canonicalId: string;
    gitRemote: string | null;
    detectedAt: string;
  };
}

export interface SyncFilterConfig {
  allowlist: string[];
  denylist: string[];
}
