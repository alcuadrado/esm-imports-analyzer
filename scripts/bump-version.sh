#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Ensure clean working tree
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree is not clean. Commit or stash changes first." >&2
  exit 1
fi

echo "==> Installing dependencies..."
pnpm install

echo "==> Running tests..."
pnpm test

echo "==> Bumping patch version..."
NEW_VERSION=$(node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  const parts = pkg.version.split('.');
  parts[2] = String(Number(parts[2]) + 1);
  pkg.version = parts.join('.');
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  console.log(pkg.version);
")
echo "    New version: v${NEW_VERSION}"

echo "==> Building project..."
pnpm run build

echo "==> Updating screenshot..."
bash "$SCRIPT_DIR/update-screenshot.sh"

echo "==> Committing and tagging..."
git add -A
git commit -m "v${NEW_VERSION}"
git tag "v${NEW_VERSION}"

echo "==> Pushing..."
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$BRANCH"
git push origin "v${NEW_VERSION}"

echo "==> Done: v${NEW_VERSION}"
