# console

Pre-release Vite + React shell for trying auth UI: Lit atoms via `@zitadel-nextgen/components`,
paired React components via `@zitadel-nextgen/ui-react`, and design tokens on the page.

## Run locally

From the repo root (after `corepack pnpm install`):

```bash
corepack pnpm nx dev @zitadel-nextgen/console
```

Open [http://localhost:5174](http://localhost:5174) — the home route is the **atom playground**
(Lit and React side by side).

In development, MSW intercepts flow API calls in the browser (same handlers as
`@zitadel-nextgen/api-mock`). You do **not** need the TCP mock server for this app.

## Related surfaces

| Surface | Command | Port |
| ------- | ------- | ---- |
| Lit playground (login flow, branding presets) | `corepack pnpm nx dev @zitadel-nextgen/components` | 5173 |
| This console (React + Lit parity) | `corepack pnpm nx dev @zitadel-nextgen/console` | 5174 |
| Next demo | `nx start @zitadel-nextgen/api-mock` + `nx dev @nextgen/demo-next` | 4000 / 3002 |
| Nuxt demo | `nx start @zitadel-nextgen/api-mock` + `nx dev @nextgen/demo-nuxt` | 4000 / 3001 |

When you change **Lit-only** atom or orchestrator source, prefer the components playground
(`:5173`) first — it reloads faster. Rebuild components before expecting console or demos
to pick up `dist/` changes:

```bash
corepack pnpm nx build @zitadel-nextgen/components
```

## Other tasks

```bash
corepack pnpm nx typecheck @zitadel-nextgen/console
corepack pnpm nx test @zitadel-nextgen/console
corepack pnpm nx build @zitadel-nextgen/console
```
