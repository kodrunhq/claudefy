import deepmerge from "deepmerge";

export class Merger {
  deepMergeJson(local: Record<string, any>, remote: Record<string, any>): Record<string, any> {
    return deepmerge(local, remote, {
      arrayMerge: (target, source) => {
        const key = this.findArrayKey(source);
        if (!key) return source;

        const remoteKeys = new Set(source.map((item: any) => item[key]));
        const localOnly = target.filter((item: any) => !remoteKeys.has(item[key]));
        return [...source, ...localOnly];
      },
    });
  }

  private findArrayKey(arr: any[]): string | null {
    if (arr.length === 0 || typeof arr[0] !== "object" || arr[0] === null) return null;
    for (const candidate of ["name", "id", "key"]) {
      if (arr.every((item: any) => item !== null && typeof item === "object" && typeof item[candidate] === "string")) {
        return candidate;
      }
    }
    return null;
  }
}
