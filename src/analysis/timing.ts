import type { ImportRecord, ModuleNode } from '../types.ts';

export interface TimingEntry {
  resolvedURL: string;
  specifier: string;
  totalTime: number;
}

export function computeRankedList(records: ImportRecord[]): TimingEntry[] {
  // Use first occurrence of each module (subsequent imports are cached)
  const seen = new Set<string>();
  const entries: TimingEntry[] = [];

  for (const record of records) {
    if (!seen.has(record.resolvedURL)) {
      seen.add(record.resolvedURL);
      entries.push({
        resolvedURL: record.resolvedURL,
        specifier: record.specifier,
        totalTime: record.loadEndTime - record.resolveStartTime,
      });
    }
  }

  // Sort descending by totalTime, stable sort preserves insertion order for equal times
  entries.sort((a, b) => b.totalTime - a.totalTime);

  return entries;
}

export function computeTotalTime(tree: ModuleNode[]): number {
  let max = 0;
  for (const root of tree) {
    max = Math.max(max, root.totalTime);
  }
  return max;
}
