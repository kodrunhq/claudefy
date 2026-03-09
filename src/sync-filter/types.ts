export type SyncTier = "allow" | "deny" | "unknown";

export interface ClassifiedItem {
  name: string;
  tier: SyncTier;
  isDirectory: boolean;
  sizeBytes: number;
}

export interface ClassificationResult {
  items: ClassifiedItem[];
  allowlist: ClassifiedItem[];
  denylist: ClassifiedItem[];
  unknown: ClassifiedItem[];
}
