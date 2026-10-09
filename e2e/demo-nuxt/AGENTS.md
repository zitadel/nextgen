# Agent Instructions — `apps/demo-nuxt-e2e/`

Playwright project that exercises `apps/demo-nuxt/` end-to-end against
the standalone `@zitadel/api-mock` TCP server. Defer to root
[`AGENTS.md`](../../AGENTS.md) for repo-wide rules.

## Scope

This project covers the boundary that Vitest cannot reach:

- `<zitadel-login>` mounted inside Nuxt's `<ClientOnly>` after the SSR pass.
- The Lit orchestrator's internal `POST /sessions/exchange` traversing
  the Nitro `/__nextgen` proxy installed by `@zitadel/sdk-nuxt`.
- The `__nextgen_session` cookie being set on the demo origin and
  surviving the full-page navigation triggered by `post-sign-in-url`.
- The Nitro auth middleware accepting that cookie on the next request
  and bouncing unauthenticated traffic back to `/login`.

It is the Nuxt-side mirror of `apps/demo-next-e2e/`. Both projects must
exist because the proxy and route-protection layers are different
implementations on each framework — a regression in one SDK does not
necessarily surface in the other.

## Non-Goals — Do Not Add Tests Here For…

- Atom rendering, ARIA, focus delegation, form participation, Enter-to-submit
  → `packages/components` Vitest unit / browser projects.
- Step transitions, error rendering, exchange call shape
  → `packages/components/src/orchestrator/zitadel-login.spec.ts` (Vitest).
- Mock handler logic, RS256 token contract, JWKS shape
  → `packages/api-mock` Vitest projects.
- Anything Vue-specific (composable behaviour, reactive bindings,
  `useState` lifecycle) → keep in `packages/sdk-nuxt`'s own unit suite,
  not here.

If a property can be proven without booting Nuxt + Nitro, it does not
belong in this project.

## Running

```sh
corepack pnpm exec playwright install        # one-time, browsers
moon run demo-nuxt-e2e:e2e
```

Moon rebuilds `@zitadel/components` first through task dependencies, then
Playwright boots `api-mock` (`:8081`) and `demo-nuxt` (`:3001`) through
direct `pnpm --filter` commands.

The api-mock listens on `:8081` here (not the default `:8080` used by
`apps/demo-next-e2e/`) so this project can run in parallel with it under
`moon run demo-next-e2e:e2e demo-nuxt-e2e:e2e` without `EADDRINUSE`. The `PORT` override is
plumbed through via Playwright's `webServer.env` and matched by the
`ZITADEL_URL` passed to the Nuxt dev server. Both knobs are
existing env contracts — no application code changes.

Cold-start for Nuxt + Vite optimiser is noticeably slower than Next; the
`webServer.timeout` is bumped to 120 s to accommodate that on CI.

## When Adding A Spec

- Mirror specs across `demo-next-e2e` and `demo-nuxt-e2e` only when the
  property genuinely depends on framework-specific behaviour. Most
  orchestrator behaviour belongs in Vitest, not duplicated here.
- Use Playwright web-first locators (`getByRole`, `getByLabel`) so
  shadow DOM is pierced consistently.
