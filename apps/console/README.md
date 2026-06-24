# console

Pre-release Vite + React shell for the internal Zitadel console — where users
will manage their account and settings. Built with `@zitadel/ui-react` atoms
and design tokens, and embedded into the Go server under `/ui/console/`.

Component development and review (atoms, paired React, and the
`<zitadel-login>` orchestrator) live in
[`apps/storybook`](../storybook/README.md), not in this app.

## Run locally

From the repo root (after `corepack pnpm install`):

```bash
moon run console:dev
```

Open [http://localhost:5174](http://localhost:5174).

## Other tasks

```bash
moon run console:typecheck
moon run console:test
moon run console:build
```
