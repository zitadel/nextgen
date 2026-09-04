# @zitadel/sdk-svelte

## 1.0.0-alpha.21

### Patch Changes

- Updated dependencies [[`a59b288`](https://github.com/zitadel/nextgen/commit/a59b288e4e52a3274c1ab4b5e4c241f1083aac6b), [`7a06425`](https://github.com/zitadel/nextgen/commit/7a06425a1b30a448bf05da8d870bd4570d304060)]:
  - @zitadel/api@1.0.0-alpha.21
  - @zitadel/components@1.0.0-alpha.21
  - @zitadel/sdk-core@1.0.0-alpha.21

## 1.0.0-alpha.20

### Patch Changes

- Updated dependencies [[`de7534a`](https://github.com/zitadel/nextgen/commit/de7534aa6a140e9ea32173a59694c71e61214e7b), [`de7534a`](https://github.com/zitadel/nextgen/commit/de7534aa6a140e9ea32173a59694c71e61214e7b), [`de7534a`](https://github.com/zitadel/nextgen/commit/de7534aa6a140e9ea32173a59694c71e61214e7b)]:
  - @zitadel/components@1.0.0-alpha.20
  - @zitadel/api@1.0.0-alpha.20
  - @zitadel/sdk-core@1.0.0-alpha.20

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

- Updated dependencies [[`d1e967d`](https://github.com/zitadel/nextgen/commit/d1e967d74ee339f9695f73185dd3097b19f527a2), [`c2888bd`](https://github.com/zitadel/nextgen/commit/c2888bdfd3c2a21fefd76a9b7fa80507d97cd88b), [`61a0eee`](https://github.com/zitadel/nextgen/commit/61a0eee0abb310a834d94b72a74f351035021be8), [`b17b2c9`](https://github.com/zitadel/nextgen/commit/b17b2c9fb3fae00f99a1864d37f3b51142ea4344), [`fc3d154`](https://github.com/zitadel/nextgen/commit/fc3d154f2fabb722c6f94633fd6c10bc60d0a657), [`35d25c3`](https://github.com/zitadel/nextgen/commit/35d25c3add44611197363ff088fc940ee3858c78), [`e26f376`](https://github.com/zitadel/nextgen/commit/e26f37617f5d3a3f92f00c07aad89a98ee9d754f), [`b7235f7`](https://github.com/zitadel/nextgen/commit/b7235f7a0ede460e504376974b370d3d95e0d3c6), [`f1049fd`](https://github.com/zitadel/nextgen/commit/f1049fd1b07086ffd070ecdd0b2d80958efd72f2), [`37e9cb9`](https://github.com/zitadel/nextgen/commit/37e9cb903943d34eebadfb44457872892f296823), [`11e6ab5`](https://github.com/zitadel/nextgen/commit/11e6ab57d611f4dc0f9732b958bff1302d4ea689), [`11e6ab5`](https://github.com/zitadel/nextgen/commit/11e6ab57d611f4dc0f9732b958bff1302d4ea689)]:
  - @zitadel/components@0.1.0-alpha.19
  - @zitadel/api@0.1.0-alpha.19
  - @zitadel/sdk-core@0.1.0-alpha.19

## 0.1.0-alpha.18

### Minor Changes

- [#711](https://github.com/zitadel/nextgen/pull/711) [`5208d86`](https://github.com/zitadel/nextgen/commit/5208d863015f78c9618317398ceda1e959c13296) Thanks [@fforootd](https://github.com/fforootd)! - The framework SDK packages (react, vue, angular, svelte, solid, qwik, nuxt) now re-export the `businessLocales` copy overlay from `@zitadel/components`, so an app that only declares its framework SDK as a direct dependency can wire the work-email wording without reaching into `@zitadel/components` (which strict package managers would not resolve). `zitadel setup --use-case business` uses this to wire the overlay into every framework's generated auth pages — previously only Next scaffolds got the business copy; the SPA scaffolds pass a plain `locales` prop to the wrapper components, and `doctor --fix` regenerates the same markup from the recorded use case.

- [#686](https://github.com/zitadel/nextgen/pull/686) [`e375e18`](https://github.com/zitadel/nextgen/commit/e375e1811b9d03ceae8b517cf2230f52957e8a5c) Thanks [@fforootd](https://github.com/fforootd)! - The framework SDK wrappers now expose the widgets' surface contract: `ZitadelLogin` and `ZitadelSession` accept `variant` (`widget` | `page`) and `theme` (`light` | `dark` | `auto`), and `ZitadelLogout` accepts `theme`, across the React, Vue, Angular, Svelte, Qwik, and Solid wrappers. The `locales` prop additionally accepts partial dictionaries, so presets like `businessLocales` are directly assignable. Apps scaffolded by `zitadel setup` pin `variant="page"` on the generated `/profile` page's `<zitadel-session>` (keeping it full-page under the new widget-first default) and reference the SDK-shipped React JSX declarations instead of carrying a hand-maintained copy.

### Patch Changes

- [#561](https://github.com/zitadel/nextgen/pull/561) [`d9607d1`](https://github.com/zitadel/nextgen/commit/d9607d19949c516f241de058aea69994b084f90b) Thanks [@fforootd](https://github.com/fforootd)! - docs: replace `@zitadel/edge-proxy` production guidance in the package READMEs with the ADR 036 model — platform rewrites/minimal worker plus a publishable key, no secrets on the platform (scaffolding tracked in zitadel/nextgen#560)

- Updated dependencies [[`7120ce3`](https://github.com/zitadel/nextgen/commit/7120ce328eb9c63bbc6ff0bad0465c7f1f49e602), [`ff66683`](https://github.com/zitadel/nextgen/commit/ff66683eeb0daa3a12e7d11fed01076ac8c2ba58), [`e375e18`](https://github.com/zitadel/nextgen/commit/e375e1811b9d03ceae8b517cf2230f52957e8a5c), [`7ea32f8`](https://github.com/zitadel/nextgen/commit/7ea32f82b582e37944535b537940f035bdda8cde), [`2c63b47`](https://github.com/zitadel/nextgen/commit/2c63b47c025e1255683b0b8cd2c48a3e25f79b3a), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c), [`1f66979`](https://github.com/zitadel/nextgen/commit/1f6697956ee81a5a28812905283ddb94f649250f), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c), [`310014f`](https://github.com/zitadel/nextgen/commit/310014f1ec8df441b161d12bb01658d27aa1f478), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c), [`d2bca36`](https://github.com/zitadel/nextgen/commit/d2bca36bdaa09168363e8e581cc4f0ef5db7eeb8), [`e0b8d3d`](https://github.com/zitadel/nextgen/commit/e0b8d3d66356f80d658198edccca3d6d77077c29), [`97470b2`](https://github.com/zitadel/nextgen/commit/97470b2d51fdf815463336ffe7999f864e510f13), [`ca91e8f`](https://github.com/zitadel/nextgen/commit/ca91e8f0368a59f9b96df2f380ec708b3b678f6c), [`ca91e8f`](https://github.com/zitadel/nextgen/commit/ca91e8f0368a59f9b96df2f380ec708b3b678f6c), [`e58a4c1`](https://github.com/zitadel/nextgen/commit/e58a4c1161d11d519d04cb944ab2875270ddc8c2), [`e375e18`](https://github.com/zitadel/nextgen/commit/e375e1811b9d03ceae8b517cf2230f52957e8a5c), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c), [`4b984af`](https://github.com/zitadel/nextgen/commit/4b984afbbde622b6f86d90ff327f4b21f9526785), [`40c8537`](https://github.com/zitadel/nextgen/commit/40c8537efc12203fce05855b9536500a4a78621a), [`e375e18`](https://github.com/zitadel/nextgen/commit/e375e1811b9d03ceae8b517cf2230f52957e8a5c), [`6394228`](https://github.com/zitadel/nextgen/commit/6394228f61426eed4bd28d0df781a98b42a9ac95), [`1395911`](https://github.com/zitadel/nextgen/commit/1395911519a40ceb4e06e8b68729376553d2768d), [`cb42772`](https://github.com/zitadel/nextgen/commit/cb427725b28a650739c5c86e72187f3df1529570), [`e375e18`](https://github.com/zitadel/nextgen/commit/e375e1811b9d03ceae8b517cf2230f52957e8a5c), [`f2cec14`](https://github.com/zitadel/nextgen/commit/f2cec1417437c4f7d33dc4bd2281b802cfebe406), [`41a2de2`](https://github.com/zitadel/nextgen/commit/41a2de240cb446cd12b438a442a55e7b90287e80), [`2975c4d`](https://github.com/zitadel/nextgen/commit/2975c4dabec68ac1a8569d6a34960de50dced1b8), [`fc441fe`](https://github.com/zitadel/nextgen/commit/fc441fed87b8f15c1b17ccdda07272d61803c862), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c), [`65da8b1`](https://github.com/zitadel/nextgen/commit/65da8b18b8a1af4e484d7cf494f8142f0539fb41)]:
  - @zitadel/api@0.1.0-alpha.18
  - @zitadel/components@0.1.0-alpha.18
  - @zitadel/sdk-core@0.1.0-alpha.18

## 0.1.0-alpha.17

### Patch Changes

- Updated dependencies [[`79d4179`](https://github.com/zitadel/nextgen/commit/79d417924518c9ea272136db1f46aaf237497999), [`363482e`](https://github.com/zitadel/nextgen/commit/363482e27c88ac96c9a2b48c880e5caa5a4dcf65), [`a0b39a1`](https://github.com/zitadel/nextgen/commit/a0b39a119408a6fa02e8e1e45ebd5dd14b96c01b)]:
  - @zitadel/components@0.1.0-alpha.17
  - @zitadel/api@0.1.0-alpha.17
  - @zitadel/sdk-core@0.1.0-alpha.17

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

- Updated dependencies [[`e4d55d2`](https://github.com/zitadel/nextgen/commit/e4d55d22c64d28a19597718417af6447a66a5852), [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19), [`1eec59e`](https://github.com/zitadel/nextgen/commit/1eec59ee924cc2b12df11f5541d6a2eef8caa6c2), [`754c7f6`](https://github.com/zitadel/nextgen/commit/754c7f6d8b970438a5ffa2c5c57ef72a2b5ed657), [`e9593cd`](https://github.com/zitadel/nextgen/commit/e9593cd4f74f5ebc010150a2ed8a3ae03b7d5d87), [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19), [`bdf2906`](https://github.com/zitadel/nextgen/commit/bdf29064ab783f1d14ea554f3512bf243e86d3b5), [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19), [`69b6b6a`](https://github.com/zitadel/nextgen/commit/69b6b6a0fa934cbbd81deba46192b3b1346612a8)]:
  - @zitadel/components@0.1.0-alpha.16
  - @zitadel/sdk-core@0.1.0-alpha.16
  - @zitadel/api@0.1.0-alpha.16

## 0.1.0-alpha.15

### Patch Changes

- Updated dependencies [[`f45d47c`](https://github.com/zitadel/nextgen/commit/f45d47c5850edc83a55b5ad7364a59ffac4fd37c)]:
  - @zitadel/components@0.1.0-alpha.15
  - @zitadel/api@0.1.0-alpha.15
  - @zitadel/sdk-core@0.1.0-alpha.15

## 0.1.0-alpha.14

### Minor Changes

- [#443](https://github.com/zitadel/nextgen/pull/443) [`ea193dc`](https://github.com/zitadel/nextgen/commit/ea193dc0fabdf3c49fa9c3e3bae4cf242001d630) Thanks [@bastionstack](https://github.com/bastionstack)! - Add a post-sign-in `<zitadel-session>` "signed in as" card: a dedicated element exposed through every SPA SDK and re-exported from sdk-next. CLI scaffolds now render it as the post-sign-in `/profile` page (with a Logout action) across all frameworks. Identity is read from `GET /sessions/me`, preferring `name` then `email` then `user_id`.

  `<zitadel-logout>` now sources its identity from the same `getMySession` operation instead of the `__nextgen_display` cookie, so both signed-in surfaces work against the real backend. Both components route their `getMySession`/`revokeMySession` calls through the shared `api-client` wrappers that enforce `credentials: "include"`.

### Patch Changes

- Updated dependencies [[`54dcc87`](https://github.com/zitadel/nextgen/commit/54dcc87084dd2d2b8314d08221354683bae64c6b), [`605abe1`](https://github.com/zitadel/nextgen/commit/605abe1f04a011c05bd4be2179556052eae6c007), [`ea193dc`](https://github.com/zitadel/nextgen/commit/ea193dc0fabdf3c49fa9c3e3bae4cf242001d630)]:
  - @zitadel/components@0.1.0-alpha.14
  - @zitadel/api@0.1.0-alpha.14
  - @zitadel/sdk-core@0.1.0-alpha.14

## 0.1.0-alpha.13

### Patch Changes

- Updated dependencies [[`b574f3a`](https://github.com/zitadel/nextgen/commit/b574f3a6e6122439fadd6f971b73a61b8554f293)]:
  - @zitadel/api@0.1.0-alpha.13
  - @zitadel/components@0.1.0-alpha.13
  - @zitadel/sdk-core@0.1.0-alpha.13

## 0.1.0-alpha.12

### Patch Changes

- Updated dependencies [[`2c32a90`](https://github.com/zitadel/nextgen/commit/2c32a90b41bdc7da736a2c3be0e8e851dbe59333), [`237c3c7`](https://github.com/zitadel/nextgen/commit/237c3c73a319e74c1411e3b04a1bb1a0e9d91051), [`a2f6526`](https://github.com/zitadel/nextgen/commit/a2f65266e00ee461e8e7fb1dee35e5add30b7199)]:
  - @zitadel/components@0.1.0-alpha.12
  - @zitadel/api@0.1.0-alpha.12
  - @zitadel/sdk-core@0.1.0-alpha.12

## 0.1.0-alpha.11

### Minor Changes

- [#285](https://github.com/zitadel/nextgen/pull/285) [`76e7381`](https://github.com/zitadel/nextgen/commit/76e7381f796ca04a7d34f349c456ee172dc714b6) Thanks [@mridang](https://github.com/mridang)! - Add Solid, Svelte and Qwik SPA SDKs that wrap the zitadel-login and zitadel-logout web components, mirroring sdk-react and sdk-vue. Every framework SDK now forwards the widget's five events (zitadel-flow-step, zitadel-flow-input, zitadel-flow-complete, zitadel-flow-error and zitadel-signout) as idiomatic callbacks, emits, or outputs that carry the typed event detail, with the shared detail types exported from @zitadel/sdk-core. All six framework SDKs build with Vite.

### Patch Changes

- Updated dependencies [[`76e7381`](https://github.com/zitadel/nextgen/commit/76e7381f796ca04a7d34f349c456ee172dc714b6), [`0b81768`](https://github.com/zitadel/nextgen/commit/0b8176857395d25c95343b5b320d074e0ba2c102), [`050f5d7`](https://github.com/zitadel/nextgen/commit/050f5d7a39a2a9160346276203e8da82db137478)]:
  - @zitadel/sdk-core@0.1.0-alpha.11
  - @zitadel/components@0.1.0-alpha.11
  - @zitadel/api@0.1.0-alpha.11
