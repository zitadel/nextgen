# Agent Instructions — `apps/demo-next-e2e/`

Playwright project that exercises `apps/demo-next/` end-to-end against
the standalone `@zitadel-nextgen/api-mock` TCP server. Defer to root
[`AGENTS.md`](../../AGENTS.md) for repo-wide rules.

## Scope

This project covers the boundary that Vitest cannot reach:

- `<zitadel-login>` mounted inside Next.js `dynamic({ ssr: false })`.
- The Lit orchestrator's internal `POST /sessions/exchange` traversing
  the Next.js `/__nextgen` proxy installed by `@zitadel-nextgen/sdk-next`.
- The `__nextgen_session` cookie being set on the demo origin and
  surviving the full-page navigation triggered by `post-sign-in-url`.
- `nextgenMiddleware` accepting that cookie on the next request and
  bouncing unauthenticated traffic back to `/login`.

## Non-Goals — Do Not Add Tests Here For…

- Atom rendering, ARIA, focus delegation, form participation, Enter-to-submit
  → `packages/components` Vitest unit / browser projects.
- Step transitions, error rendering, exchange call shape, focus management
  → `packages/components/src/orchestrator/zitadel-login.spec.ts` (Vitest).
- Mock handler logic, RS256 token contract, JWKS shape
  → `packages/api-mock` Vitest projects.
- Visual regression / accessibility audits
  → not yet wired; route through `chrome-devtools` MCP per
  [`browser-verification`](../../.cursor/rules/browser-verification.mdc).

If a property can be proven without booting Next, it does not belong in
this project.

## Running

```sh
corepack pnpm exec playwright install        # one-time, browsers
corepack pnpm exec nx run @nextgen/demo-next-e2e:e2e
```

Nx rebuilds `@zitadel-nextgen/components` first via `^build`, then
Playwright boots `api-mock` (`:4000`) and `demo-next` (`:3002`) through
direct `pnpm --filter` commands. Using `nx run …` inside
`webServer.command` makes `@nx/playwright/plugin` treat the dev servers
as required deps and hangs the run — keep the direct invocations.

## When Adding A Spec

- One terminal assertion per behaviour. Most checks should use
  Playwright web-first locators (`getByRole`, `getByLabel`) rather than
  raw selectors so shadow DOM is pierced consistently.
- Mirror the spec in `apps/demo-nuxt-e2e/` if and only if the property
  depends on framework-specific middleware. Component-level behaviour
  goes in Vitest.
- Specs are paired (one spec per behaviour, identifiable filename) so
  individual failures point straight at the affected boundary.
