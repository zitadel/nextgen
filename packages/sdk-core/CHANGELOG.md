# @zitadel/sdk-core

## 0.1.0-alpha.19

### Minor Changes

- [#830](https://github.com/zitadel/nextgen/pull/830) [`35d25c3`](https://github.com/zitadel/nextgen/commit/35d25c3add44611197363ff088fc940ee3858c78) Thanks [@fforootd](https://github.com/fforootd)! - Theming and header controls for the login surface:
  - The primary button now consumes the semantic `--zl-primary` /
    `--zl-primary-foreground` pair (Figma-owned values; the previous legacy
    role tokens remain as fallback). Expect a slight visual shift on stock
    buttons; setting the pair on the host element — or
    `branding.palette.primary` / `branding.palette.on_primary`, which now
    feed both vocabularies — restyles the CTA. Hover intentionally stays on
    the legacy hover role until Figma publishes a primary-scoped hover value.
  - `branding.palette.link` finally reaches the links: card navigation,
    forgot-password, and field links consume a new `--zl-color-text-link`
    contract variable (defined by default as an alias of the existing purple
    accent, which resolves per theme). Previously the palette key recolored
    pills instead of links.
  - New `suppress-header` boolean on `<zitadel-login>` and
    `<zitadel-session>` (and a `suppressHeader` prop on every framework
    wrapper): visually hides the widget's own heading block while keeping it
    in the accessibility tree — for embeds whose page already carries the
    heading. Works with user-ejected branding templates too.

### Patch Changes

- [#856](https://github.com/zitadel/nextgen/pull/856) [`b17b2c9`](https://github.com/zitadel/nextgen/commit/b17b2c9fb3fae00f99a1864d37f3b51142ea4344) Thanks [@fforootd](https://github.com/fforootd)! - The package documentation now matches what the packages actually do. The Next and Nuxt guides drop the removed `api-base` attribute in favor of `configureZitadel()` and the `project` property; the Nuxt guide documents the Nuxt module (what `zitadel setup` wires) with its real options and the `useAuth()` / `useZitadelProject()` composables, alongside the hand-rolled middleware path with its full option set. `@zitadel/sdk-core` and `@zitadel/api` gain real documentation of their entry points, `@zitadel/config` gains a package README, and the SPA guides document the `ZitadelSession` card and point local no-proxy experiments at the local runtime's actual default port (8080). The flow-editing guide copied into `.zitadel/flows/` no longer suggests cross-flow `switch`/`pivot` transitions, which the runtime does not execute yet, and API examples use the real prefixed ID format (`proj_…`, `team_…`) instead of a retired naming scheme.

- Updated dependencies [[`b17b2c9`](https://github.com/zitadel/nextgen/commit/b17b2c9fb3fae00f99a1864d37f3b51142ea4344), [`fc3d154`](https://github.com/zitadel/nextgen/commit/fc3d154f2fabb722c6f94633fd6c10bc60d0a657), [`e26f376`](https://github.com/zitadel/nextgen/commit/e26f37617f5d3a3f92f00c07aad89a98ee9d754f)]:
  - @zitadel/api@0.1.0-alpha.19

## 0.1.0-alpha.18

### Minor Changes

- [#686](https://github.com/zitadel/nextgen/pull/686) [`e375e18`](https://github.com/zitadel/nextgen/commit/e375e1811b9d03ceae8b517cf2230f52957e8a5c) Thanks [@fforootd](https://github.com/fforootd)! - The framework SDK wrappers now expose the widgets' surface contract: `ZitadelLogin` and `ZitadelSession` accept `variant` (`widget` | `page`) and `theme` (`light` | `dark` | `auto`), and `ZitadelLogout` accepts `theme`, across the React, Vue, Angular, Svelte, Qwik, and Solid wrappers. The `locales` prop additionally accepts partial dictionaries, so presets like `businessLocales` are directly assignable. Apps scaffolded by `zitadel setup` pin `variant="page"` on the generated `/profile` page's `<zitadel-session>` (keeping it full-page under the new widget-first default) and reference the SDK-shipped React JSX declarations instead of carrying a hand-maintained copy.

- [#717](https://github.com/zitadel/nextgen/pull/717) [`cb42772`](https://github.com/zitadel/nextgen/commit/cb427725b28a650739c5c86e72187f3df1529570) Thanks [@fforootd](https://github.com/fforootd)! - Give the embedding app a supported way to read session state for its own chrome (header navigation, account menus) — previously the widgets read `GET /sessions/me` internally but the host page had no documented path to the same answer and kept rendering signed-out CTAs beside a live session.
  - `@zitadel/sdk-next` ships a new `@zitadel/sdk-next/session` entry with `getSession()`: a client-side read of the same-origin `{proxyPath}/sessions/me` (the exact read `<zitadel-session>` performs). Works on any page — unlike server-side `auth()` it does not require the route to be covered by the middleware `matcher` — and returns the client-safe `ClientAuthResult` (`userId`/`email`/`name`, no token). 401, the backend's JSON 404, and anonymous sessions map to signed-out; other failures — including a framework's HTML 404 from a misrouted proxy — throw instead of silently rendering signed-out.
  - The client-safe auth shapes (`ClientSession`, `ClientAuthState`, `ClientAuthResult`) move to `@zitadel/sdk-core` as the single source; `@zitadel/sdk-nuxt` re-exports them unchanged, so its `useAuth()` and sdk-next's `getSession()` now return the identical shape.
  - CLI scaffold guidance (`AGENTS.md` managed section) and the generated profile pages now name each framework's session read: `getSession()` on Next, the auto-imported `useAuth()` composable on Nuxt, and the raw `/__nextgen/sessions/me` read for the SPA frameworks.

- [#718](https://github.com/zitadel/nextgen/pull/718) [`fc441fe`](https://github.com/zitadel/nextgen/commit/fc441fed87b8f15c1b17ccdda07272d61803c862) Thanks [@fforootd](https://github.com/fforootd)! - Harden the sdk-next auth surface: verify the tunnelled session token, and keep the raw token out of client-side JavaScript.
  - **`auth()` now verifies instead of trusts.** Previously it decoded the `x-nextgen-auth-token` header without verification and treated any other non-empty value as a middleware-validated opaque token — on routes outside the middleware `matcher`, a client-supplied header could spoof any identity. `auth()` now re-verifies every value: JWTs cryptographically via JWKS (same rules and defaults as the middleware, in-process key cache), opaque tokens against `GET /sessions/me` (deduplicated per render pass via React `cache()`), failing closed on anything unverified. Opaque sessions also gain the real identity (`userId`/`email`/`name` from the backend) instead of `userId: "unknown"`. New optional `AuthOptions` mirror the middleware's verification options for apps that customise them.
  - **`NextgenProvider` strips the session token server-side.** Passing `await auth()` into the provider previously serialised the raw token into the RSC flight payload, readable by any client script. The provider is now a shared component that converts to the client-safe `ClientAuthResult` before the value crosses the server→client boundary, so client components only ever see `userId`/`email`/`name` — matching sdk-nuxt, which already stripped the token from its SSR payload. `useAuth()` returns `ClientAuthResult` accordingly.
  - **New `@zitadel/sdk-next/react` entry** for client components (`useAuth`, `AuthContextProvider`). `NextgenProvider` itself is **server-only** (exported from `@zitadel/sdk-next/server` and the root): it accepts the token-bearing `auth()` result, so re-exporting it through a `"use client"` wrapper would serialise the raw token across the boundary before the strip runs — the `server-only` guard turns that wrapper into a build error. Client-seeded trees (e.g. from `getSession()`) use `AuthContextProvider`, which only accepts the token-less shape. The package root is likewise a server-module surface. The package also builds as per-file modules now, fixing `"use client"` directives that were previously lost in bundled chunks — the provider/hook entries were unusable from published builds.
  - **`opaqueTokenTimeoutMs` is honoured.** The Next middleware silently ignored the documented option and reused `jwksTimeoutMs` for its `GET /sessions/me` validation; both the middleware and `auth()` now thread `opaqueTokenTimeoutMs` (default 5000 ms), matching sdk-nuxt.
  - `@zitadel/sdk-core` exports `isJwtShaped()` (JWS vs JWE structural detection), shared by the middleware and `auth()`.

### Patch Changes

- [#603](https://github.com/zitadel/nextgen/pull/603) [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c) Thanks [@fforootd](https://github.com/fforootd)! - Ship a real light theme. The legacy `--zl-color-*` tokens the auth atoms consume are now authored as `{ dark, light }` pairs and emitted into the `[data-theme="light"]` block, so switching modes actually repaints surfaces, text, borders, icons, and the focus ring — previously that block only carried the shadcn namespace, and light mode resolved correctly while every surface stayed dark. `<zitadel-login>` gains a `theme` property (`light | dark | auto`); resolution runs element property → `branding.theme.mode` → variant default, where a `page` stays dark (the design system's primary surface) and an embedded `widget` follows `prefers-color-scheme` instead of forcing a dark card onto a light host page.

- [#603](https://github.com/zitadel/nextgen/pull/603) [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c) Thanks [@fforootd](https://github.com/fforootd)! - Flip `<zitadel-login>` to widget-first: the default `variant="widget"` is content-sized, transparent through every layer, injects no default font into the host document, and never steals focus on load — the embedding app owns the page. Dedicated login routes (hosted shell, scaffolded pages) opt into the previous full-page behavior with `variant="page"`. Split-family responsive chrome now keys off the widget's own width via container queries (baseline 2023 browsers), the hero design ships neutral placeholder copy instead of fabricated claims, and split tenants with only a `hero_url` keep a compact banner fallback on narrow widths.

- Updated dependencies [[`7120ce3`](https://github.com/zitadel/nextgen/commit/7120ce328eb9c63bbc6ff0bad0465c7f1f49e602), [`7ea32f8`](https://github.com/zitadel/nextgen/commit/7ea32f82b582e37944535b537940f035bdda8cde), [`2c63b47`](https://github.com/zitadel/nextgen/commit/2c63b47c025e1255683b0b8cd2c48a3e25f79b3a), [`1f66979`](https://github.com/zitadel/nextgen/commit/1f6697956ee81a5a28812905283ddb94f649250f), [`d2bca36`](https://github.com/zitadel/nextgen/commit/d2bca36bdaa09168363e8e581cc4f0ef5db7eeb8), [`e0b8d3d`](https://github.com/zitadel/nextgen/commit/e0b8d3d66356f80d658198edccca3d6d77077c29), [`97470b2`](https://github.com/zitadel/nextgen/commit/97470b2d51fdf815463336ffe7999f864e510f13), [`e58a4c1`](https://github.com/zitadel/nextgen/commit/e58a4c1161d11d519d04cb944ab2875270ddc8c2), [`4b984af`](https://github.com/zitadel/nextgen/commit/4b984afbbde622b6f86d90ff327f4b21f9526785), [`40c8537`](https://github.com/zitadel/nextgen/commit/40c8537efc12203fce05855b9536500a4a78621a), [`f2cec14`](https://github.com/zitadel/nextgen/commit/f2cec1417437c4f7d33dc4bd2281b802cfebe406), [`41a2de2`](https://github.com/zitadel/nextgen/commit/41a2de240cb446cd12b438a442a55e7b90287e80), [`2975c4d`](https://github.com/zitadel/nextgen/commit/2975c4dabec68ac1a8569d6a34960de50dced1b8)]:
  - @zitadel/api@0.1.0-alpha.18

## 0.1.0-alpha.17

### Patch Changes

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.17

## 0.1.0-alpha.16

### Patch Changes

- [#514](https://github.com/zitadel/nextgen/pull/514) [`1eec59e`](https://github.com/zitadel/nextgen/commit/1eec59ee924cc2b12df11f5541d6a2eef8caa6c2) Thanks [@fforootd](https://github.com/fforootd)! - Select a flow definition by name. `<zitadel-login>` gains a `flow-name`
  attribute (`flowName` prop on every framework wrapper) that sends
  `flow_definition_name` on flow start, so a project with several synced
  flows can run a specific one instead of the audience-resolved default.
  An unknown name or a purpose mismatch surfaces as a clear startup error
  naming the attribute. Audience selection itself is now honored and
  deterministic: hinted app beats hinted team beats the newest unscoped
  flow, and a flow scoped to an app/team no longer captures the project
  default. The flows README and plan/apply docs explain how to add and
  select a second flow.

  Because newest-unscoped-wins means a new flow can silently take over the
  default login, `plan` warns on any create of an active, unscoped flow in
  a project that already has flows (`warn/default-flow-swap`, a
  non-blocking `# warning:` line and a `--json` warnings entry) — scope
  the flow via `audience` or pin `flow-name` in the widget to opt out.
  The offline dialect gains the committed `auth-methods`/`auth-method`
  meta-schema copies that `user-schema.json` references, so editors
  resolve the full dialect without network access.

- [#502](https://github.com/zitadel/nextgen/pull/502) [`bdf2906`](https://github.com/zitadel/nextgen/commit/bdf29064ab783f1d14ea554f3512bf243e86d3b5) Thanks [@fforootd](https://github.com/fforootd)! - Scaffolded projects now explain their own next step. `zitadel setup` writes
  an `AGENTS.md` guidance section for AI agents and an "Authentication
  (Zitadel)" section into the app README (marker-fenced — existing content is
  never clobbered), copies the flow/schema dialect meta-schemas into
  `.zitadel/meta/`, and scaffolds flow files with
  `"$schema": "../meta/flow-definition.json"` so editors validate and
  autocomplete flow edits offline. The `$schema` pointer is local-only: sync
  ignores it and write-back preserves it. `ZitadelLogin` wrappers gain typed
  `locales`/`lang` props for labelling custom flow steps (see the new
  "Customize copy" docs page).

  `zitadel eject` removes what setup wrote: the marker-fenced guidance section
  is stripped from `README.md`/`AGENTS.md` (content outside the markers is
  untouched), and a file is deleted only when nothing but the scaffold-created
  header would remain — no stale golden path survives pointing at deleted
  `.zitadel/` files.

  Every SDK wrapper now forwards `locales`/`lang` to the widget (previously
  only React did; Solid/Qwik/Svelte accepted and discarded them, Vue/Angular
  did not expose them). The flow dialect meta-schema (`@zitadel/server`
  embeds it; `@zitadel/config` ships the committed copy) marks a transition's
  `action` as nullable, matching the OpenAPI contract — editors no longer
  flag `"action": null`.

- Updated dependencies [[`e9593cd`](https://github.com/zitadel/nextgen/commit/e9593cd4f74f5ebc010150a2ed8a3ae03b7d5d87), [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19)]:
  - @zitadel/api@0.1.0-alpha.16

## 0.1.0-alpha.15

### Patch Changes

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.15

## 0.1.0-alpha.14

### Minor Changes

- [#443](https://github.com/zitadel/nextgen/pull/443) [`ea193dc`](https://github.com/zitadel/nextgen/commit/ea193dc0fabdf3c49fa9c3e3bae4cf242001d630) Thanks [@bastionstack](https://github.com/bastionstack)! - Add a post-sign-in `<zitadel-session>` "signed in as" card: a dedicated element exposed through every SPA SDK and re-exported from sdk-next. CLI scaffolds now render it as the post-sign-in `/profile` page (with a Logout action) across all frameworks. Identity is read from `GET /sessions/me`, preferring `name` then `email` then `user_id`.

  `<zitadel-logout>` now sources its identity from the same `getMySession` operation instead of the `__nextgen_display` cookie, so both signed-in surfaces work against the real backend. Both components route their `getMySession`/`revokeMySession` calls through the shared `api-client` wrappers that enforce `credentials: "include"`.

### Patch Changes

- Updated dependencies [[`605abe1`](https://github.com/zitadel/nextgen/commit/605abe1f04a011c05bd4be2179556052eae6c007)]:
  - @zitadel/api@0.1.0-alpha.14

## 0.1.0-alpha.13

### Patch Changes

- Updated dependencies [[`b574f3a`](https://github.com/zitadel/nextgen/commit/b574f3a6e6122439fadd6f971b73a61b8554f293)]:
  - @zitadel/api@0.1.0-alpha.13

## 0.1.0-alpha.12

### Patch Changes

- Updated dependencies [[`a2f6526`](https://github.com/zitadel/nextgen/commit/a2f65266e00ee461e8e7fb1dee35e5add30b7199)]:
  - @zitadel/api@0.1.0-alpha.12

## 0.1.0-alpha.11

### Minor Changes

- [#285](https://github.com/zitadel/nextgen/pull/285) [`76e7381`](https://github.com/zitadel/nextgen/commit/76e7381f796ca04a7d34f349c456ee172dc714b6) Thanks [@mridang](https://github.com/mridang)! - Add Solid, Svelte and Qwik SPA SDKs that wrap the zitadel-login and zitadel-logout web components, mirroring sdk-react and sdk-vue. Every framework SDK now forwards the widget's five events (zitadel-flow-step, zitadel-flow-input, zitadel-flow-complete, zitadel-flow-error and zitadel-signout) as idiomatic callbacks, emits, or outputs that carry the typed event detail, with the shared detail types exported from @zitadel/sdk-core. All six framework SDKs build with Vite.

### Patch Changes

- [#310](https://github.com/zitadel/nextgen/pull/310) [`050f5d7`](https://github.com/zitadel/nextgen/commit/050f5d7a39a2a9160346276203e8da82db137478) Thanks [@mridang](https://github.com/mridang)! - CLI scaffolds now write the project service-key secret to `.env.local` as `ZITADEL_PROJECT_SECRET`, and the React/Vue/Angular dev proxies plus the Next.js and Nuxt server middlewares send it as the bearer on every proxied request instead of synthesising `sk_<project_id>` from the public project id. The secret stays server-side: `.env.local` is gitignored, Vite only exposes `VITE_`-prefixed vars to the client, Next.js auto-loads `.env.local` into `process.env` server-side, and the Nuxt module reads `process.env.ZITADEL_PROJECT_SECRET` in its `setup()` and pushes it into Nuxt's server-only `runtimeConfig.nextgen.projectSecret` (overridable at deploy time via `NUXT_NEXTGEN_PROJECT_SECRET`).

  Also drops the unused `onExchangeResponse` hook from `NextgenMiddlewareOptions` (no callers anywhere; alpha so no external usage to break).

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.11

## 0.1.0-alpha.10

## 0.1.0-alpha.9

## 0.1.0-alpha.8

## 0.1.0-alpha.7

## 0.1.0-alpha.6

## 0.1.0-alpha.5

## 0.1.0-alpha.4

## 0.1.0-alpha.3

## 0.1.0-alpha.2

## 0.1.0-alpha.0

### Minor Changes

- [#206](https://github.com/zitadel/nextgen/pull/206) [`3aa1d5f`](https://github.com/zitadel/nextgen/commit/3aa1d5f62af87fe4b6658dbed914bac515e3f0de) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Wire up the end-to-end passkey registration and login flow across the
  API, component, and SDK surfaces:
  - `@zitadel/api`: expose the passkey registration OpenAPI contract to the
    generated TypeScript client.
  - `@zitadel/components`: refresh the `<zl-passkey>` atom and the
    `<zitadel-login>` orchestrator templates (consolidated `default.liquid` +
    `layout-chrome.css`, dropped the standalone passkey-upsell/signed-in
    partials) and expand the `en`/`de` locale strings for the passkey steps.
  - `@zitadel/sdk-next`: extend `auth` and the request `middleware` to drive the
    passkey register/login round-trip.
  - `@zitadel/sdk-core`: adjust JWT handling to support the flow.

- [#209](https://github.com/zitadel/nextgen/pull/209) [`fdabcff`](https://github.com/zitadel/nextgen/commit/fdabcffb28a0058375d97f671152ebb3075f3703) Thanks [@bastionstack](https://github.com/bastionstack)! - Rename the public packages to the `@zitadel` scope and publish them to npm via changesets with GitHub OIDC trusted publishing. This is the first `@zitadel/*`-scoped release line, cut as an `alpha` prerelease.

### Patch Changes

- [#150](https://github.com/zitadel/nextgen/pull/150) [`5761ad2`](https://github.com/zitadel/nextgen/commit/5761ad2a2914d328203f5863b120e95300c60a22) Thanks [@mridang](https://github.com/mridang)! - Remove the pre-claim / claim lifecycle from the CLI and api-mock. The `zitadel claim` and `zitadel claim status` commands, the `ClaimClient` interface, the `InitClaim*` / `ClaimStatus*` schemas, the `claimed_at` / `team_id` fields on `.zitadel/secret`, the `E_CLAIM_REQUIRED` and `E_PLATFORM_HANDOFF` error codes, the production-claim gates in `apply` and `deploy connect`, and the api-mock's `claim/init` / `claim/status` handlers and `completeMockClaim()` export are all gone. The SDK's `resolveZitadelRuntime` production-issuer error message no longer references the removed `zitadel claim` command. `/projects/{id}/claim/init` and `/projects/{id}/claim/status` are not in the OpenAPI spec and have no backend; the surface only worked against the mock.
