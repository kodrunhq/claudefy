import deepmerge from "deepmerge";

export class Merger {
  deepMergeJson(
    local: Record<string, unknown>,
    remote: Record<string, unknown>,
  ): Record<string, unknown> {
    return deepmerge(local, remote, {
      arrayMerge: (target: unknown[], source: unknown[]) => {
        // Primitive arrays: strict-equality union
        if (
          source.length > 0 &&
          source.every((item) => typeof item !== "object" || item === null)
        ) {
          const seen = new Set(source);
          const localOnly = target.filter((item) => !seen.has(item));
          return [...source, ...localOnly];
        }

        // Empty source: preserve target
        if (source.length === 0) {
          return [...target];
        }

        // Object arrays: try key-based dedup
        const key = this.findArrayKey(source);
        if (key) {
          const remoteKeys = new Set(source.map((item) => (item as Record<string, unknown>)[key]));
          const localOnly = target.filter(
            (item) => !remoteKeys.has((item as Record<string, unknown>)[key]),
          );
          return [...source, ...localOnly];
        }

        // Object arrays without identifiable key: JSON-based dedup
        const sourceJson = new Set(source.map((item) => JSON.stringify(item)));
        const localOnly = target.filter((item) => !sourceJson.has(JSON.stringify(item)));
        return [...source, ...localOnly];
      },
    });
  }

  private findArrayKey(arr: unknown[]): string | null {
    if (arr.length === 0 || typeof arr[0] !== "object" || arr[0] === null) return null;
    for (const candidate of ["name", "id", "key"]) {
      if (
        arr.every(
          (item) =>
            item !== null &&
            typeof item === "object" &&
            typeof (item as Record<string, unknown>)[candidate] === "string",
        )
      ) {
        return candidate;
      }
    }
    return null;
  }
}
