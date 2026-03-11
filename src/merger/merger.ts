import deepmerge from "deepmerge";

export class Merger {
  deepMergeJson(
    local: Record<string, unknown>,
    remote: Record<string, unknown>,
  ): Record<string, unknown> {
    return deepmerge(local, remote, {
      arrayMerge: (target: unknown[], source: unknown[]) => {
        const key = this.findArrayKey(source);
        if (!key) return source;

        const remoteKeys = new Set(source.map((item) => (item as Record<string, unknown>)[key]));
        const localOnly = target.filter(
          (item) => !remoteKeys.has((item as Record<string, unknown>)[key]),
        );
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
