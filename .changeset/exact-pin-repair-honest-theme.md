---
"@zitadel/cli": patch
---

The `dependency-version` doctor warning now repairs with the project's own package manager and an exact-save flag (`npm install --save-exact` / `pnpm add --save-exact` / `yarn add --exact` / `bun add --exact`) instead of always suggesting a bare `npm install`, which would have switched managers on pnpm/yarn/bun projects and rewritten the exact pin as a caret range the check deliberately ignores. The repair command is also emitted as a structured `next_commands` entry, matching the agent contract's prefer-structured guidance. Widget-posture scaffolds now describe `theme="auto"` accurately: it follows the OS `prefers-color-scheme`, not the host app's own theme, and the generated comments and guidance say how to pin `theme="light"`/`"dark"` for apps that fix their scheme.
