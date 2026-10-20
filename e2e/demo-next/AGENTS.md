# Agent Instructions — the demo lanes (`e2e/demo-next`, `e2e/demo-nuxt`)

The demo lanes drive `apps/demo-next` and `apps/demo-nuxt` end to end, and
cover only what Vitest cannot reach: the framework integration. Both
frameworks have lanes because each SDK implements the proxy and route
protection differently, so a regression in one does not show in the other.

| Lane | Specs | Backend | App |
| --- | --- | --- | --- |
| `moon run e2e:demo-next-mock` | `demo-next/src/` | `@zitadel/api-mock` on `:8080` | `:3002` |
| `moon run e2e:demo-next-real` | `demo-next/src-real/` | a real instance on `:8092` (`@zitadel/testing`) | `:3002` |
| `moon run e2e:demo-nuxt-mock` | `demo-nuxt/src/` | `@zitadel/api-mock` on `:8081` | `:3001` |

The Nuxt lane's mock gets its own port so both mock lanes run side by side.
Install browsers once with
`corepack pnpm --filter @zitadel/e2e exec playwright install`. How the lanes
run in CI and locally:
[`packages/testing/AGENTS.md`](../../packages/testing/AGENTS.md#moon-and-the-e2e-lanes).

## What belongs here

On each framework, the lanes prove that:

- `<zitadel-login>` mounts inside the client-only boundary (Next's
  `dynamic({ ssr: false })`, Nuxt's `<ClientOnly>`);
- the orchestrator's `POST /sessions/exchange` passes the SDK's `/__nextgen`
  proxy;
- the `__nextgen_session` cookie is set on the demo origin and survives the
  full-page navigation to `post-sign-in-url`;
- the SDK's middleware accepts it on the next request and sends
  unauthenticated traffic back to `/login`.

The real lane adds registration, password sign-in and authenticated
navigation against real storage. It covers no passkeys: it seeds the shipped
`password-first` flow, and the journey's `passkey-first` lane covers the
passkey round trip.

## What does not

A property that can be proven without booting the framework does not belong
here.

- Atom rendering, ARIA, focus, form participation, Enter-to-submit:
  `packages/components`' Vitest projects.
- Step transitions, error rendering, the exchange call's shape:
  `packages/components/src/orchestrator/zitadel-login.spec.ts`.
- Mock handlers, the RS256 token contract, the JWKS shape:
  `packages/api-mock`.
- Accessibility audits: Storybook (`addon-a11y` with `test: "error"`). Visual
  regression is not wired.
- Vue specifics (composables, reactive bindings, `useState`):
  `packages/sdk-nuxt`'s unit suite.

## Writing a spec

- Mirror a spec in the other demo only when the property depends on that
  framework's middleware.
- One behaviour per spec file, named so a failure points at its boundary, and
  one terminal assertion per behaviour.
- Use web-first locators (`getByRole`, `getByLabel`), so shadow DOM is
  pierced the same way everywhere.
