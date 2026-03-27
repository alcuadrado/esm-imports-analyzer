import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ImportRecord, Group } from '../types.ts';

interface PackageJsonInfo {
  name: string;
  dir: string;
  packageJsonPath: string;
  isNodeModules: boolean;
}

const packageJsonCache = new Map<string, PackageJsonInfo | null>();

function findPackageJson(dir: string): PackageJsonInfo | null {
  if (packageJsonCache.has(dir)) {
    return packageJsonCache.get(dir)!;
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

  for (const record of records) {
    const url = record.resolvedURL;

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

  return [...groupMap.values()];
}

// Clear the cache (useful for testing)
export function clearPackageJsonCache(): void {
  packageJsonCache.clear();
}
