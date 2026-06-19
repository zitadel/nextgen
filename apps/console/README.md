# console

Pre-release Vite + React shell for the internal console: paired atoms from
`@zitadel/ui-react` and design tokens on the page. Lit atoms live in the
components playground (`:5173`); compare visuals across two tabs, not on this app.

## Run locally

From the repo root (after `corepack pnpm install`):

```bash
moon run console:dev
```

Open [http://localhost:5174](http://localhost:5174) — the home route is the **React atom
playground** (same matrices as `?route=atoms` on the Lit dev server).

In development, MSW intercepts flow API calls in the browser (same handlers as
`@zitadel/api-mock`). You do **not** need the TCP mock server for this app.

## Related surfaces

| Surface | Command | URL |
| ------- | ------- | --- |
| Lit atoms + login (MSW in browser) | `moon run components:dev` | [http://localhost:5173/?route=atoms](http://localhost:5173/?route=atoms) · [login](http://localhost:5173/?route=login) |
| React atoms (this app, MSW in browser) | `moon run console:dev` | [http://localhost:5174](http://localhost:5174) |
| Next.js SDK (cookies, middleware, built `dist/`) | `moon run api-mock:start` then `ZITADEL_URL=http://localhost:4000 moon run demo-next:dev` | mock [http://localhost:4000](http://localhost:4000) · app [http://localhost:3002/login](http://localhost:3002/login) |
| Nuxt SDK (cookies, middleware, built `dist/`) | mock as above, then `ZITADEL_URL=http://localhost:4000 moon run demo-nuxt:dev` | mock `:4000` · app [http://localhost:3001/login](http://localhost:3001/login) |

When you change **Lit-only** atom or orchestrator source, prefer the components playground
(`:5173`) first — it reloads faster. Rebuild components before expecting console or demos
to pick up `dist/` changes:

```bash
moon run components:build
```

## Other tasks

```bash
moon run console:typecheck
moon run console:test
moon run console:build
```
