# Agent Instructions — `apps/storybook`

The unified component workbench. Read together with the
[root `AGENTS.md`](../../AGENTS.md) and [`README.md`](README.md).

## What's in here

A single `@storybook/web-components-vite` instance that hosts `@zitadel/components`
(Lit atoms), `@zitadel/ui-react` (paired React), and the orchestrators
(`<zitadel-login>`, `<zitadel-session>` — see `src/session.stories.ts`), so
Figma parity is visible side by side and the orchestrators can
be driven against `@zitadel/api-mock`. It is a dev tool, not a shipped package
(`private`, no `dist`, `build` is `runInCI: false`), but `storybook:test` runs
in CI.

## Hard rules

- **One instance, two renderers.** Lit atoms and the orchestrator render
  natively; React renders through [`src/react-render.ts`](src/react-render.ts).
  Do not add Storybook Composition or a second Storybook — that's the pattern
  this app exists to avoid.
- **One component, controls for state.** A story is the single component driven
  by `args`/`argTypes` controls — not a grid of static instances and not one
  story per state. Use a control (e.g. `previewState`) to flip interaction
  states. Do not reintroduce hand-rolled "matrix" stories.
- **Mirror pairs in one file.** Every paired component is a single story file
  with two stories, `Lit` and `React`, under one `Atoms/<Name>` title sharing
  the same args, so divergence shows up in the sidebar. Don't split renderers
  into separate files or add a redundant single-story (`Playground`) level.
- **Assert parity, don't eyeball it.** Each pair file also gets a third
  `Parity` story that mounts *both* renderers and, in its `play`, calls
  `assertParity` ([`src/parity.ts`](src/parity.ts)) to diff `getComputedStyle`
  for each shared `.zr-*` selector — the Lit node in its shadow root, the React
  node in its container. This is the automated form of the side-by-side eyeball
  and the hard gate on box-model/colour/type drift between renderers (it caught
  the `box-sizing` and inherited `line-height` gotchas documented in
  `packages/shared-component-styles/AGENTS.md`). Turn a11y off on this story
  (`parameters: { a11y: { test: "off" } }`) — two live widgets on one page is a
  test rig, and the `Lit`/`React` stories already carry the a11y gate.
- **Tokens, not magic values.** Visuals come from `@zitadel/design-tokens`
  (imported once in `.storybook/preview.ts`). The shared `.zr-*` surface CSS is
  owned by `@zitadel/shared-component-styles`; stories never restyle atoms.
- **Behaviour lives in the source packages; don't duplicate upward.** This app
  gates render + a11y for every story. Add a `play` function only when no lower
  layer proves the behaviour: the Lit atoms own toggle/form/focus in
  `packages/components` specs, so their stories carry no `play`; the React pairs
  have no component-level spec, so their story's `play` is the sole behavioural
  test for them.
- **MSW is orchestrator-only.** The atoms make no requests, so
  `msw-storybook-addon` is wired on the orchestrator stories (not globally),
  and those stories are tagged `no-test` to keep network out of the test run.

## Recipe: add a paired component (Figma → Storybook)

The repeatable flow that built `select`. Each step links the package whose
scoped `AGENTS.md` owns the rules — read those for the parity gotchas
(`box-sizing`, inherited text, color clashes) rather than rediscovering them.

1. **Design.** Pull the frame with the Figma MCP (`get_design_context` /
   `get_screenshot`); note the states, the WAI-ARIA pattern, and which tokens it
   uses. A missing value is a new token in `@zitadel/design-tokens` — never a
   magic value in CSS.
2. **Icon (only if new).** Add the glyph to **both** registries or the pair
   drifts: `packages/components/src/atoms/zl-icon.ts` (`IconName` union +
   `SHIPPED_ICON_NAMES` + `ICON_NODES`) and `packages/ui-react/src/icon.tsx`
   (`IconName` type + `REGISTRY`).
3. **Shared CSS** (`packages/shared-component-styles`, see its `AGENTS.md`):
   create `src/<id>.css` (the `.zr-<id>` surface) and `src/lit/<id>-host.css`
   (`:host`/slots). Mirror `baseHostStyles` for the React subtree (box-sizing
   block + inherited text props on the root). Register in three places:
   `@import` in `src/styles.css` (and add the root to the font-smoothing group),
   the `./<id>.css` + `./lit/<id>-host.css` exports in `package.json`, and an
   entry in `pairs.json`.
4. **Lit atom** (`packages/components`, see its `AGENTS.md`): create
   `src/atoms/zl-<id>.ts` — `static formAssociated = true` if it holds a value,
   import the CSS with `?inline`, and export a manifest. Register: export from
   `src/atoms/index.ts`, add the manifest to `src/manifests.ts`, and re-export
   the public API from `src/index.ts`.
5. **React pair** (`packages/ui-react`): create `src/<id>.tsx` using the **same**
   `.zr-*` classes; export it from `src/index.ts`.
6. **Tests — lowest layer that proves the property** (don't duplicate upward):
   - `src/atoms/zl-<id>.spec.ts` (jsdom: markup + ARIA).
   - `src/atoms/zl-<id>.browser.spec.ts` (chromium: form participation,
     keyboard, focus) — only if it has real-platform behaviour.
   - Add the tag to `src/manifests.spec.ts` and its events to
     `src/atoms/event-contract.spec.ts`.
   - React behaviour is covered by the `React` story's `play` (no
     component-level React spec).
7. **Stories** (`src/<id>.stories.tsx`): three stories under one `Atoms/<Name>`
   title — `Lit`, `React`, and `Parity` (mounts both + `assertParity`). One
   controls-driven story per renderer; states are knobs, not extra stories.
8. **Verify.** Dev loop: `storybook dev -p 6006` (HMR from source). Gate:
   `moon run components:test` (unit), `moon run storybook:typecheck`, and
   `moon run storybook:test` (render + a11y + parity diff + plays in Chromium).

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
