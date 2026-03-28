// ESM module — uses semver (CJS package imported from ESM)
import semver from 'semver';

export function isCompatible(version, range) {
  return semver.satisfies(version, range);
}

export function bumpPatch(version) {
  return semver.inc(version, 'patch');
}

export function parseVersion(version) {
  const parsed = semver.parse(version);
  if (!parsed) return null;
  return { major: parsed.major, minor: parsed.minor, patch: parsed.patch };
}
