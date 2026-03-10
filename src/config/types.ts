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
  };
  machineId: string;
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
