import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface MachineEntry {
  machineId: string;
  hostname: string;
  os: string;
  lastSync: string;
  registeredAt: string;
}

interface Manifest {
  version: number;
  machines: MachineEntry[];
}

export class MachineRegistry {
  private manifestPath: string;

  constructor(manifestPath: string) {
    this.manifestPath = manifestPath;
  }

  async register(machineId: string, hostname: string, os: string): Promise<void> {
    const manifest = await this.loadManifest();
    const existing = manifest.machines.find((m) => m.machineId === machineId);

    if (existing) {
      existing.hostname = hostname;
      existing.os = os;
      existing.lastSync = new Date().toISOString();
    } else {
      manifest.machines.push({
        machineId,
        hostname,
        os,
        lastSync: new Date().toISOString(),
        registeredAt: new Date().toISOString(),
      });
    }

    await this.saveManifest(manifest);
  }

  async updateLastSync(machineId: string): Promise<void> {
    const manifest = await this.loadManifest();
    const machine = manifest.machines.find((m) => m.machineId === machineId);
    if (machine) {
      machine.lastSync = new Date().toISOString();
      await this.saveManifest(manifest);
    }
  }

  async list(): Promise<MachineEntry[]> {
    const manifest = await this.loadManifest();
    return manifest.machines;
  }

  private async loadManifest(): Promise<Manifest> {
    if (!existsSync(this.manifestPath)) {
      return { version: 1, machines: [] };
    }
    const raw = await readFile(this.manifestPath, "utf-8");
    return JSON.parse(raw);
  }

  private async saveManifest(manifest: Manifest): Promise<void> {
    await writeFile(this.manifestPath, JSON.stringify(manifest, null, 2));
  }
}
