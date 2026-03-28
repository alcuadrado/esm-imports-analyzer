#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Install dependencies for fixtures that have a pnpm-lock.yaml
for lockfile in $(find test -name "pnpm-lock.yaml" -not -path "*/node_modules/*"); do
  dir=$(dirname "$lockfile")
  echo "==> Installing $dir"
  (cd "$dir" && pnpm install)
done

# Scaffold fake node_modules structure for nested-pkg-json fixture
FAKE_PKG="test/integration/fixtures/nested-pkg-json/node_modules/fake-pkg"
mkdir -p "$FAKE_PKG/lib/esm"
echo '{ "name": "fake-pkg", "version": "1.0.0" }' > "$FAKE_PKG/package.json"
echo 'export default {}' > "$FAKE_PKG/lib/esm/index.js"
echo "==> Scaffolded $FAKE_PKG"
