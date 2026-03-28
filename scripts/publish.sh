#!/usr/bin/env bash
set -euo pipefail

# Ensure we're at the repo root
cd "$(git rev-parse --show-toplevel)"

# Get the version from package.json
VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version)")
TAG="v$VERSION"

# Check if this version is already published
PUBLISHED_VERSION=$(npm view esm-imports-analyzer version 2>/dev/null || echo "")
if [ "$PUBLISHED_VERSION" = "$VERSION" ]; then
  echo "==> Version $VERSION is already published on npm. Nothing to do."
  exit 0
fi

echo "==> Publishing esm-imports-analyzer $TAG"

# 1. Run the tests
echo "==> Running tests..."
pnpm test

# 2. Build the project
echo "==> Building..."
pnpm build

# 3. Run the example in examples/tests
echo "==> Running example..."
cd examples/tests
pnpm install
pnpm run analyze
cd ../..

# 4. Publish to npm
echo "==> Publishing to npm..."
npm publish

# 5. Commit and tag the new version
echo "==> Committing and tagging $TAG..."
git add -A
git commit -m "$TAG" || echo "Nothing to commit"
git tag "$TAG"

# 6. Push the commit and tag
echo "==> Pushing to remote..."
git push
git push origin "$TAG"

# 7. Update the demo branch with the report
echo "==> Updating demo branch..."
REPORT="examples/tests/esm-imports-report.html"

if [ ! -f "$REPORT" ]; then
  echo "Error: $REPORT not found"
  exit 1
fi

# Create an orphan demo branch with only index.html
TMPDIR=$(mktemp -d)
cp "$REPORT" "$TMPDIR/index.html"

git checkout --orphan demo-tmp
git rm -rf .
cp "$TMPDIR/index.html" index.html
git add index.html
git commit -m "Update demo for $TAG"
git branch -M demo-tmp demo
git push origin demo --force

# Switch back to the original branch
git checkout main

rm -rf "$TMPDIR"

echo "==> Done! Published $TAG"
