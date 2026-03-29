#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXAMPLE_DIR="$PROJECT_ROOT/examples/tests"
REPORT="$EXAMPLE_DIR/esm-imports-report.html"
SCREENSHOT="$PROJECT_ROOT/screenshot.png"

echo "==> Building project..."
cd "$PROJECT_ROOT"
pnpm run build

echo "==> Installing example dependencies..."
cd "$EXAMPLE_DIR"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

echo "==> Generating report..."
node "$PROJECT_ROOT/dist/cli.js" -- node --test test/run-all.js

echo "==> Taking screenshot..."
cd "$PROJECT_ROOT"
npx playwright install chromium 2>/dev/null || true
node --input-type=module -e "
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
});
await page.goto('file://${REPORT}');

// Wait for cytoscape canvas to render
await page.waitForSelector('#cy canvas', { timeout: 15000 });

// Wait for the layout overlay to be hidden (layout complete)
await page.waitForSelector('#layout-overlay.hidden', { timeout: 30000 });

// Small extra wait for final rendering/paint
await page.waitForTimeout(500);

await page.screenshot({ path: '${SCREENSHOT}' });
await browser.close();
console.log('Screenshot saved to ${SCREENSHOT}');
"

echo "==> Done: $SCREENSHOT"
