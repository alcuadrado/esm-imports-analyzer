# Example Project

A small ESM project using `node:test` that exercises different import patterns:

- **ESM packages**: `lodash-es`, `chalk`, `ms`
- **CJS packages imported from ESM**: `semver`, `debug`
- **Local CJS module**: `legacy.cjs` loaded via `createRequire`
- **Circular dependencies**: `registry.js` <-> `plugin.js`
- **Top-level await**: `config.js` reads `package.json` at import time
- **Node builtins**: `node:fs/promises`, `node:path`, `node:url`

## Setup

```bash
pnpm install
```

## Run tests

```bash
pnpm test
```

## Analyze imports

```bash
pnpm run analyze
```

This generates `esm-imports-report.html` — open it in a browser.
