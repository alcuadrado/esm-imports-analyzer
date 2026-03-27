import type { ImportRecord, Cycle } from '../types.ts';

// Build adjacency list from import records
function buildAdjacencyList(records: ImportRecord[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  for (const record of records) {
    if (!graph.has(record.resolvedURL)) {
      graph.set(record.resolvedURL, new Set());
    }
    if (record.parentURL !== null) {
      if (!graph.has(record.parentURL)) {
        graph.set(record.parentURL, new Set());
      }
      graph.get(record.parentURL)!.add(record.resolvedURL);
    }
  }

  return graph;
}

// Tarjan's SCC algorithm
function tarjanSCC(graph: Map<string, Set<string>>): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const sccs: string[][] = [];

  function strongconnect(v: string): void {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    const neighbors = graph.get(v) ?? new Set<string>();
    for (const w of neighbors) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  }

  for (const v of graph.keys()) {
    if (!indices.has(v)) {
      strongconnect(v);
    }
  }

  return sccs;
}

// Extract individual cycles from SCCs using DFS
function extractCycles(scc: string[], graph: Map<string, Set<string>>): Cycle[] {
  if (scc.length === 1) {
    const node = scc[0]!;
    const neighbors = graph.get(node) ?? new Set<string>();
    if (neighbors.has(node)) {
      return [{ modules: [node], length: 1 }];
    }
    return [];
  }

  const sccSet = new Set(scc);
  const cycles: Cycle[] = [];
  const visited = new Set<string>();

  function dfs(start: string, current: string, path: string[]): void {
    const neighbors = graph.get(current) ?? new Set<string>();
    for (const next of neighbors) {
      if (!sccSet.has(next)) continue;
      if (next === start && path.length > 0) {
        cycles.push({ modules: [...path], length: path.length });
      } else if (!visited.has(next) && !path.includes(next)) {
        dfs(start, next, [...path, next]);
      }
    }
  }

  for (const node of scc) {
    visited.clear();
    dfs(node, node, [node]);
    visited.add(node);
  }

  // Deduplicate cycles (same set of nodes in different rotations)
  const unique = new Map<string, Cycle>();
  for (const cycle of cycles) {
    const key = [...cycle.modules].sort().join('\0');
    if (!unique.has(key) || cycle.length < unique.get(key)!.length) {
      unique.set(key, cycle);
    }
  }

  return [...unique.values()];
}

export function detectCycles(records: ImportRecord[]): Cycle[] {
  const graph = buildAdjacencyList(records);
  const sccs = tarjanSCC(graph);
  const cycles: Cycle[] = [];

  for (const scc of sccs) {
    cycles.push(...extractCycles(scc, graph));
  }

  // Sort by cycle length (shortest first)
  cycles.sort((a, b) => a.length - b.length);

  return cycles;
}
