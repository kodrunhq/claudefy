import deepmerge from "deepmerge";

export class Merger {
  deepMergeJson(local: Record<string, any>, remote: Record<string, any>): Record<string, any> {
    return deepmerge(local, remote, {
      // Remote wins on array conflicts (replace, don't concatenate)
      arrayMerge: (_target, source) => source,
    });
  }
}
