import type { ImportRecord } from '../types.ts';

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
        totalTime: (record.resolveEndTime - record.resolveStartTime) + (record.loadEndTime - record.loadStartTime),
      });
    }
  }

  // Sort descending by totalTime, stable sort preserves insertion order for equal times
  entries.sort((a, b) => b.totalTime - a.totalTime);

  return entries;
}

export function computeTotalTime(records: ImportRecord[]): number {
  if (records.length === 0) return 0;
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const record of records) {
    if (record.resolveStartTime < minStart) minStart = record.resolveStartTime;
    if (record.loadEndTime > maxEnd) maxEnd = record.loadEndTime;
  }
  return maxEnd - minStart;
}
