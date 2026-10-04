# Agent Instructions — `apps/storybook`

The unified component workbench. Read together with the
[root `AGENTS.md`](../../AGENTS.md) and [`README.md`](README.md).

## What's in here

A single `@storybook/web-components-vite` instance that hosts `@zitadel/components`
— the Lit atoms and the orchestrators (`<zitadel-login>`, `<zitadel-session>` —
see `src/session.stories.ts`) — so atoms can be checked against Figma and the
orchestrators can be driven against `@zitadel/api-mock`. This is the workbench
for the **login surface only**; console UI iterates on the console dev server
(ADR 055). It is a dev tool, not a published npm package (`private`): it ships
no package `dist`. It does build a static site into `dist/` via `storybook:build`
— deployed to Vercel as a shared preview, and the `dist` output convention is in
[`apps/AGENTS.md`](../AGENTS.md). That build runs in CI (Vercel is a CI
environment), as does `storybook:test`.

## Hard rules

- **One instance, one renderer.** Everything here is a custom element and
  renders natively. Do not add Storybook Composition, a second Storybook, or a
  React renderer — that's the pattern this app exists to avoid.
- **One component, controls for state.** A story is the single component driven
  by `args`/`argTypes` controls — not a grid of static instances and not one
  story per state. Use a control (e.g. `previewState`) to flip interaction
  states. Do not reintroduce hand-rolled "matrix" stories.
- **One story file per atom, one story in it.** `src/<id>.stories.ts` exports
  `Default` under an `Atoms/<Name>` title. Don't split an atom across files or
  add a redundant second (`Playground`) level.
- **Tokens, not magic values.** Visuals come from `@zitadel/design-tokens`
  (imported once in `.storybook/preview.ts`). An atom's CSS is owned by
  `packages/components/src/atoms/zl-<id>.css`; stories never restyle atoms.
- **Behaviour lives in the source packages; don't duplicate upward.** This app
  gates render + a11y for every story. Add a `play` function only when no lower
  layer proves the behaviour — the atoms own toggle/form/focus in
  `packages/components` specs, so their stories generally carry no `play`.
- **MSW is orchestrator-only.** The atoms make no requests, so
  `msw-storybook-addon` is wired on the orchestrator stories (not globally),
  and those stories are tagged `no-test` to keep network out of the test run.

## Orchestrator stories & the flow engine

The `<zitadel-login>` orchestrator renders **whatever the flow engine returns** —
it has no opinion of its own. In Storybook that engine is `@zitadel/api-mock`
(an xstate machine + fixtures), driven through `msw-storybook-addon`. So its
controls split in two, grouped with `argTypes.<name>.table.category`:

- **Component** — host props set on the element: `purpose`, `variant`, `theme`,
  `previewState`.
- **Flow engine** — what the backend returns (applied as mock overlays in
  `beforeEach`, not element props): `branding`, `sso`, `passkey`.

### Theming has two separate systems — do not conflate them

- **Atoms** read the design-system default tokens, which carry both modes, and
  switch on `data-theme` on `<html>` (dark `:root`, light `:root[data-theme=…]`).
- **The orchestrator does NOT read document `data-theme`.** It paints from the
  **branding** the flow returns, resolved by `ThemeController`. The `theme`
  property can override, with this precedence (`theme-controller.ts`):
  1. **If the branding publishes only one palette side, that side wins and
     `theme` is ignored** (you can't select a mode with no colours).
  2. otherwise: element `theme` → `branding.theme.mode` → variant default
     (`page` → dark, `widget` → auto).
  So the `theme` control only visibly toggles when the selected `branding` ships
  **both** sides: `centered` (now two-sided), `two-sided`, and `none` (no
  branding → design-system defaults) toggle; `dark` / `light-only` / `split` are
  single-sided and force their one side. This is the #1 source of "the theme
  toggle doesn't work" confusion.

### What each control is, and where it comes from

- **`variant`** (`widget` | `page`) — a **host prop**, front-end only. `page`
  fills its container and paints its own background; `widget` is content-sized
  and transparent for embedding. It does not come from the backend.
- **`layout`** (`centered` | `split`) — comes from the **backend**
  (`branding.layout`), there is **no** element prop for it. `split` is **retired**
  (#1039): it only renders via the legacy `*-template` liquid presets, not the
  default template — a bare `layout: "split"` is a no-op. Don't add a `layout`
  control expecting split to render.
- **`branding`** — backend-returned; there is no `branding` prop. The Storybook
  presets (`branding-presets.ts`) are fixtures overlaid via `applyBranding`.
  `none` applies nothing → design-system defaults.
- **`sso`** — backend overlay via `applySsoProviders` (`off` / `google` /
  `google-github`). A **scalar** on purpose so it round-trips in the URL.
- **`passkey`** — backend overlay via `applyPasskey` (off by default). When on,
  the identifier step gains a "Sign in with a passkey" action. Both overlays are
  off by default so the mock keeps mirroring the shipped flow (and the api-mock
  conformance spec stays green).

### Shareable links

Storybook encodes args in the URL (`?path=…&args=branding:dark;sso:google`), so
every control change is a shareable link. Keep controls **scalar** (enums /
booleans) so they serialise cleanly; editable object/array controls do **not**
round-trip and break the shareable-link guarantee.

### Stateful-element isolation (don't remove)

`.storybook/preview.ts` keys each mock-backed story's subtree on the story id
**and args**, so switching stories or flipping a knob rebuilds the stateful
`<zitadel-login>`. Without it, a flow driven to its terminal "signed-in" step
leaks into the next render and the next story shows blank.

### Step coverage (and what can't be a story)

One-story-with-knobs is the **atom** rule; the orchestrator additionally has
step-journey stories, because a backend-driven step can only be shown by driving
the flow to it (via `play`). Covered: `identifier` (SignIn), `register` (SignUp),
`password` (PasswordStep), `register-password` (RegisterPasswordStep), `recover`
(RecoverStep), `done` (SignedIn), `register-sso` (RegisterAfterProvider),
`sso-conflict` (ConflictAfterProvider), identifier + providers, identifier +
passkey offer (PasskeyOffered), and the passkey ceremony step `passkey-login`
(PasskeyLogin).

`passkey-login` is special: the step mounts an invisible `<zl-passkey>` that
auto-runs a real `navigator.credentials.get()` ceremony on mount — the OS passkey
prompt, which can't complete in the workbench. `freezePasskeyCeremony()`
(`orchestrator-shared.ts`) stands in for that browser API with a promise that
never settles (the same `Promise.race([])` stub the component specs use), so the
atom stays in its `pending` state and renders its real "waiting for your passkey"
UI instead of raising the prompt. It mocks a browser API the same way `msw` mocks
the network; the story installs it in `beforeEach` and the returned teardown
restores `navigator.credentials` so no other story is affected. This is also why
`<zl-passkey>` still has no atom story — frozen, it only has a pending state.

**Not storied on purpose:** `passkey-setup` / `passkey-upsell` (legacy; the
default flow no longer routes through them — don't revive them to force a story),
and `sso-redirect` (transient — it navigates away).

The password field renders with name **`x-auth-methods#password`** (the schema
pointer, exported as `PASSWORD_FIELD`), not `"password"` — use `PASSWORD_FIELD`
when a `play` fills or waits on it.

### Verify permutations for real

When you change a control or preset, **load the stories and read the component's
resolved state** — host `data-theme`, provider-button count, the rendered step —
across branding × theme × sso. Do not assume from the code; the single-sided
gating above has repeatedly made "looks done" wrong.

## Recipe: add an atom (Figma → Storybook)

The repeatable flow that built `select`. Each step links the package whose
scoped `AGENTS.md` owns the rules — read those rather than rediscovering them.

1. **Design.** Pull the frame with the Figma MCP (`get_design_context` /
   `get_screenshot`); note the states, the WAI-ARIA pattern, and which tokens it
   uses. A missing value is a new token in `@zitadel/design-tokens` — never a
   magic value in CSS.
2. **Icon (only if new).** Add the glyph to
   `packages/components/src/atoms/zl-icon.ts` (`IconName` union +
   `SHIPPED_ICON_NAMES` + `ICON_NODES`).
3. **CSS** (`packages/components`, see its `AGENTS.md`): create
   `src/atoms/zl-<id>.css` beside the atom — `:host`/slot rules first, then the
   painted `.zr-<id>` surface. One file; there is no separate host sheet.
4. **Lit atom** (`packages/components`, see its `AGENTS.md`): create
   `src/atoms/zl-<id>.ts` — `static formAssociated = true` if it holds a value,
   import the CSS with `./zl-<id>.css?inline`, and export a manifest. Register:
   export from `src/atoms/index.ts`, add the manifest to `src/manifests.ts`, and
   re-export the public API from `src/index.ts`.
5. **Tests — lowest layer that proves the property** (don't duplicate upward):
   - `src/atoms/zl-<id>.spec.ts` (jsdom: markup + ARIA).
   - `src/atoms/zl-<id>.browser.spec.ts` (chromium: form participation,
     keyboard, focus) — only if it has real-platform behaviour.
   - Add the tag to `src/manifests.spec.ts` and its events to
     `src/atoms/event-contract.spec.ts`.
6. **Story** (`src/<id>.stories.ts`): one `Default` story under an
   `Atoms/<Name>` title. States are knobs, not extra stories.
7. **Verify.** Dev loop: `storybook dev -p 6006` (HMR from source). Gate:
   `moon run components:test` (unit + browser projects), `moon run
   storybook:typecheck`, and `moon run storybook:test` (render + a11y + plays in
   Chromium). For just the fast unit lane while iterating, use
   `pnpm --filter @zitadel/components test`.

## Local checks

```sh
moon run storybook:typecheck
moon run storybook:build
moon run storybook:test
```

`storybook:test` (and any `--project browser` Vitest run) launches real Chromium
and pre-bundles the workspace from source, so the **first** run is slow
(60–120s+) while later runs are fast on a warm `node_modules/.vite` cache — it is
not hung. Don't pipe it through `tail` (buffers until EOF) and don't kill-and-
retry without first clearing strays (`pkill -f vitest; pkill -f chrome-headless-shell`),
or the next run stalls on `Port … is in use`. See
[`packages/components/AGENTS.md`](../../packages/components/AGENTS.md#the-browser-project-hangs--it-doesnt-its-cold-start).
