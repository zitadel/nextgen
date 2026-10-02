# @zitadel/eslint-config

Shared ESLint [flat config](https://eslint.org/docs/latest/use/configure/configuration-files)
base for the packages and apps in this monorepo.

It exports a single flat-config array holding everything that was identical
across the per-package configs:

- `@eslint/js` recommended + `typescript-eslint` recommended
- `eslint-plugin-import` (recommended + typescript resolver, wired to the
  `@zitadel/source` export condition)
- `eslint-plugin-perfectionist` import sorting and `eslint-plugin-prettier`
- the hardened TypeScript rules (`no-explicit-any`, `no-non-null-assertion`,
  `consistent-type-imports`, `no-unused-vars`) as errors, relaxed in tests
- `@eslint/json` (JSON + JSONC) and `@eslint/markdown`
- a universal `ignores` block for build, framework (`.next`, `.nuxt`,
  `.svelte-kit`, …), coverage and generated output, kept in sync with the repo
  `.prettierignore` so ESLint and Prettier skip the same files

## What it does not include

- **Framework plugins** — React, Svelte, Solid, Qwik and Nuxt layers are too
  package-specific to share, so each package keeps its own.
- **Package-specific `ignores`** — the base covers the output directories every
  package produces; anything unique to one package (e.g. test fixtures) is
  added by that consumer.

## Usage

```js
// eslint.config.js
import { defineConfig } from "eslint/config";
import zitadel from "@zitadel/eslint-config";

export default defineConfig(
  zitadel,
  // …any package-specific ignores or framework blocks…
);
```

Add it as a dev dependency:

```json
{
  "devDependencies": {
    "@zitadel/eslint-config": "workspace:*"
  }
}
```
