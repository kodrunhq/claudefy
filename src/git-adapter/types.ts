export interface StoreStatus {
  isClean: boolean;
  ahead: number;
  behind: number;
  modified: string[];
  added: string[];
  deleted: string[];
}

export interface SyncMetadata {
  machineId: string;
  hostname: string;
  os: string;
  lastSync: string;
}
