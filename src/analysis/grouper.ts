import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ImportRecord, Group } from '../types.ts';
import { buildFolderTree } from './folder-tree.ts';

interface PackageJsonInfo {
  name: string;
  dir: string;
  packageJsonPath: string;
  isNodeModules: boolean;
}

const packageJsonCache = new Map<string, PackageJsonInfo | null>();

function getNodeModulesPackageRoot(dir: string): string | null {
  const SEP = '/node_modules/';
  const lastNM = dir.lastIndexOf(SEP);
  if (lastNM === -1) return null;

  const afterNM = dir.substring(lastNM + SEP.length);
  const parts = afterNM.split('/');
  if (parts.length === 0 || parts[0] === '') return null;

  // Scoped package: @scope/pkg
  if (parts[0].startsWith('@')) {
    if (parts.length < 2) return null;
    return dir.substring(0, lastNM) + SEP + parts[0] + '/' + parts[1];
  }

  // Regular package: pkg
  return dir.substring(0, lastNM) + SEP + parts[0];
}

function findPackageJson(dir: string): PackageJsonInfo | null {
  if (packageJsonCache.has(dir)) {
    return packageJsonCache.get(dir)!;
  }

  // For paths inside node_modules, jump directly to the package root
  // instead of walking up and potentially hitting nested package.json files.
  const nmRoot = getNodeModulesPackageRoot(dir);
  if (nmRoot !== null && nmRoot !== dir) {
    const result = findPackageJson(nmRoot);
    packageJsonCache.set(dir, result);
    return result;
  }

  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const content = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
      const name = (typeof content['name'] === 'string' ? content['name'] : dirname(dir).split('/').pop()) as string;
      const isNodeModules = dir.includes('node_modules');
      const info: PackageJsonInfo = {
        name,
        dir,
        packageJsonPath: pkgPath,
        isNodeModules,
      };
      packageJsonCache.set(dir, info);
      return info;
    } catch {
      // Invalid package.json, keep searching
    }
  }

  const parent = dirname(dir);
  if (parent === dir) {
    // Reached filesystem root
    packageJsonCache.set(dir, null);
    return null;
  }

  const result = findPackageJson(parent);
  packageJsonCache.set(dir, result);
  return result;
}

export function groupModules(records: ImportRecord[]): Group[] {
  const groupMap = new Map<string, Group>();
  const seenURLs = new Set<string>();

  for (const record of records) {
    const url = record.resolvedURL;
    if (seenURLs.has(url)) continue;
    seenURLs.add(url);

    // Handle node: builtins
    if (url.startsWith('node:')) {
      const id = 'node-builtins';
      if (!groupMap.has(id)) {
        groupMap.set(id, {
          id,
          label: 'Node.js Builtins',
          packageJsonPath: '',
          modules: [],
          isNodeModules: false,
        });
      }
      groupMap.get(id)!.modules.push(url);
      continue;
    }

    // Handle data: URLs
    if (url.startsWith('data:')) {
      const id = 'inline-modules';
      if (!groupMap.has(id)) {
        groupMap.set(id, {
          id,
          label: 'Inline Modules',
          packageJsonPath: '',
          modules: [],
          isNodeModules: false,
        });
      }
      groupMap.get(id)!.modules.push(url);
      continue;
    }

    // Handle file: URLs
    if (url.startsWith('file://')) {
      let filePath: string;
      try {
        filePath = fileURLToPath(url);
      } catch {
        continue;
      }
      const dir = dirname(filePath);
      const pkgInfo = findPackageJson(dir);

      if (pkgInfo) {
        const id = resolve(pkgInfo.dir);
        if (!groupMap.has(id)) {
          groupMap.set(id, {
            id,
            label: pkgInfo.name,
            packageJsonPath: pkgInfo.packageJsonPath,
            modules: [],
            isNodeModules: pkgInfo.isNodeModules,
          });
        }
        groupMap.get(id)!.modules.push(url);
      } else {
        const id = 'ungrouped';
        if (!groupMap.has(id)) {
          groupMap.set(id, {
            id,
            label: 'Ungrouped',
            packageJsonPath: '',
            modules: [],
            isNodeModules: false,
          });
        }
        groupMap.get(id)!.modules.push(url);
      }
    }
  }

  const groups = [...groupMap.values()];

  // Build folder trees for groups that have a package directory
  for (const group of groups) {
    if (group.packageJsonPath) {
      const packageDir = dirname(group.packageJsonPath);
      group.folderTree = buildFolderTree(group.id, packageDir, group.modules);
    }
  }

  return groups;
}

// Clear the cache (useful for testing)
export function clearPackageJsonCache(): void {
  packageJsonCache.clear();
}
