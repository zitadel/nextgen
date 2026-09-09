# Agent Instructions — `apps/demo-next-e2e/`

Playwright project that exercises `apps/demo-next/` end-to-end. It has two
suites: the **mock lane** (`e2e`, against the standalone `@zitadel/api-mock`
TCP server, specs under `src/`) and the **real lane** (`e2e-real`, specs under
`src-real/` with `playwright.real.config.mts`), which boots a real server
instance through `@zitadel/testing` (`ZITADEL_SERVER_BINARY`,
`NEXTGEN_SERVER_{LOGIN,CONSOLE}_ENABLED=false`) and covers registration,
password sign-in, and authenticated navigation against real storage. It does
not cover passkeys: the lane seeds the shipped `password-first` default flow,
which offers no passkey action, and the real-server passkey round trip is
covered by `cli-journey-e2e`'s `passkey-first` preset lane. This project is the flagship Playwright consumer of the test kit —
see [`packages/testing/AGENTS.md`](../../packages/testing/AGENTS.md). The
real lane runs in CI through an explicit `full-pr` step even though its moon
task carries `runInCI: false`. Defer to root
[`AGENTS.md`](../../AGENTS.md) for repo-wide rules.

## Scope

The mock lane covers the boundary that Vitest cannot reach:

- `<zitadel-login>` mounted inside Next.js `dynamic({ ssr: false })`.
- The Lit orchestrator's internal `POST /sessions/exchange` traversing
  the Next.js `/__nextgen` proxy installed by `@zitadel/sdk-next`.
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
  → not yet wired.

If a property can be proven without booting Next, it does not belong in
this project.

## Running

```sh
corepack pnpm exec playwright install        # one-time, browsers
moon run demo-next-e2e:e2e                   # mock lane
moon run demo-next-e2e:e2e-real              # real-instance lane (@zitadel/testing)
```

Moon rebuilds `@zitadel/components` first through task dependencies, then
Playwright boots `api-mock` (`:8080`) and `demo-next` (`:3002`) through
direct `pnpm --filter` commands.

## When Adding A Spec

- One terminal assertion per behaviour. Most checks should use
  Playwright web-first locators (`getByRole`, `getByLabel`) rather than
  raw selectors so shadow DOM is pierced consistently.
- Mirror the spec in `apps/demo-nuxt-e2e/` if and only if the property
  depends on framework-specific middleware. Component-level behaviour
  goes in Vitest.
- Specs are paired (one spec per behaviour, identifiable filename) so
  individual failures point straight at the affected boundary.
