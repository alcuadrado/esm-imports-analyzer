# Mocha Example

A small ESM project with mocha tests that exercises:

- ESM imports (`lodash-es`, `chalk`, `ms`)
- CJS imports (`legacy.cjs` using `require()`)
- Circular dependencies (`registry.js` <-> `plugin.js`)

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
